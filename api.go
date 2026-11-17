package main

// HTTP API. Every response is JSON; errors are {"error": "..."} with text meant for the user.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

type API struct {
	s       *Store
	modules []Module

	cmu     sync.Mutex
	clients map[chan int64]struct{}
}

func (a *API) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/state", a.state)
	mux.HandleFunc("PUT /api/settings", a.settings)
	mux.HandleFunc("GET /api/events", a.events)
	mux.HandleFunc("PUT /api/upload", a.upload)
	mux.HandleFunc("PUT /api/files/{id}", a.replace)
	mux.HandleFunc("GET /api/files/{id}", a.download)
	mux.HandleFunc("POST /api/folders", a.folder)
	mux.HandleFunc("POST /api/move", a.move)
	mux.HandleFunc("PATCH /api/items/{id}", a.rename)
	mux.HandleFunc("POST /api/delete", a.delete)
	mux.HandleFunc("POST /api/restore", a.restore)
	mux.HandleFunc("POST /api/trash/empty", a.emptyTrash)
}

// ---------- helpers ----------

func writeJSON(w http.ResponseWriter, status int, b []byte) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	w.Write(b)
}

func fail(w http.ResponseWriter, status int, msg string) {
	b, _ := json.Marshal(map[string]string{"error": msg})
	writeJSON(w, status, b)
}

// reply marshals v; call it while holding the lock so the item can't change halfway.
func reply(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

// readJSON accepts only application/json bodies up to 1 MB. Requiring the
// content type means another website can't send these requests without a CORS
// preflight, which this server never grants.
func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "application/json" {
		fail(w, 415, "Expected JSON")
		return false
	}
	http.NewResponseController(w).SetReadDeadline(time.Now().Add(30 * time.Second))
	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(v)
	if err != nil && !errors.Is(err, io.EOF) {
		fail(w, 400, "Invalid request")
		return false
	}
	return true
}

// receive streams a request body to a temp file and checks it is exactly n bytes.
func (a *API) receive(w http.ResponseWriter, r *http.Request, n int64) (string, error) {
	http.NewResponseController(w).SetReadDeadline(time.Now().Add(time.Hour)) // 100 MB over a slow link
	f, err := os.CreateTemp(a.s.tmp, "up-")
	if err != nil {
		return "", err
	}
	got, err := io.Copy(f, io.LimitReader(r.Body, n+1))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil && got != n {
		err = errors.New("incomplete upload")
	}
	if err != nil {
		os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}

// drain reads and discards a refused upload so the browser gets to see the error,
// for at most 30 seconds so a client that lies about its size can't hold on.
func drain(w http.ResponseWriter, r *http.Request, n int64) {
	http.NewResponseController(w).SetReadDeadline(time.Now().Add(30 * time.Second))
	io.Copy(io.Discard, io.LimitReader(r.Body, n))
}

func (a *API) moduleList() []map[string]any {
	out := make([]map[string]any, 0, len(a.modules))
	for _, m := range a.modules {
		on, set := a.s.db.Settings.Modules[m.ID]
		if !set {
			on = m.Default == nil || *m.Default
		}
		out = append(out, map[string]any{"id": m.ID, "name": m.Name, "description": m.Description,
			"icon": m.Icon, "order": m.Order, "hasCss": m.HasCSS, "enabled": on})
	}
	return out
}

// ---------- live updates (Server-Sent Events) ----------

func (a *API) broadcast(v int64) {
	a.cmu.Lock()
	defer a.cmu.Unlock()
	for ch := range a.clients {
		select {
		case ch <- v:
		default: // still has an update queued; it reloads anyway
		}
	}
}

func (a *API) events(w http.ResponseWriter, r *http.Request) {
	a.cmu.Lock()
	if len(a.clients) >= 256 {
		a.cmu.Unlock()
		fail(w, 503, "Too many open windows")
		return
	}
	ch := make(chan int64, 1)
	a.clients[ch] = struct{}{}
	a.cmu.Unlock()
	defer func() { a.cmu.Lock(); delete(a.clients, ch); a.cmu.Unlock() }()

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	rc := http.NewResponseController(w)
	a.s.mu.Lock()
	v := a.s.version
	a.s.mu.Unlock()
	fmt.Fprintf(w, "retry: 2000\ndata: %d\n\n", v)
	rc.Flush()
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case v := <-ch:
			fmt.Fprintf(w, "data: %d\n\n", v)
		case <-ping.C:
			io.WriteString(w, ": ping\n\n")
		case <-r.Context().Done():
			return
		}
		if rc.Flush() != nil {
			return
		}
	}
}

// ---------- handlers ----------

func (a *API) state(w http.ResponseWriter, r *http.Request) {
	s := a.s
	s.mu.Lock()
	items := make([]*Item, 0, len(s.db.Items))
	for _, it := range s.db.Items {
		items = append(items, it)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Created != items[j].Created {
			return items[i].Created < items[j].Created
		}
		return items[i].ID < items[j].ID
	})
	b := reply(map[string]any{"version": s.version, "quota": s.quota, "used": s.used(), "items": items,
		"modules": a.moduleList()})
	s.mu.Unlock()
	writeJSON(w, 200, b)
}

func (a *API) settings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Modules map[string]any `json:"modules"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	s := a.s
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, m := range a.modules {
		if on, ok := body.Modules[m.ID].(bool); ok {
			s.db.Settings.Modules[m.ID] = on
		}
	}
	s.save()
	writeJSON(w, 200, reply(map[string]any{"modules": a.moduleList()}))
}

// PUT /api/upload?name=&parent=&x=&y=&mtime= with the file as the raw body
func (a *API) upload(w http.ResponseWriter, r *http.Request) {
	s, q := a.s, r.URL.Query()
	parent := Parent(q.Get("parent"))
	name := cleanName(q.Get("name"))
	n := r.ContentLength
	s.mu.Lock()
	switch free := s.free(); {
	case !s.validParent(parent):
		s.mu.Unlock()
		fail(w, 400, "Folder no longer exists")
		return
	case name == "":
		s.mu.Unlock()
		fail(w, 400, "Invalid file name")
		return
	case n < 0:
		s.mu.Unlock()
		fail(w, 411, "Content-Length required")
		return
	case s.full():
		s.mu.Unlock()
		drain(w, r, n)
		fail(w, 507, tooMany)
		return
	case n > free:
		s.mu.Unlock()
		drain(w, r, n)
		fail(w, 413, fmt.Sprintf("Not enough space: %q is %s, only %s free of %s.", name, fmtBytes(n), fmtBytes(max(0, free)), fmtBytes(s.quota)))
		return
	}
	s.reserved += n
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.reserved -= n; s.mu.Unlock() }()

	tmp, err := a.receive(w, r, n)
	if err != nil {
		fail(w, 400, "Upload failed: "+err.Error())
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.validParent(parent) { // the folder went away during the upload
		os.Remove(tmp)
		fail(w, 400, "Folder no longer exists")
		return
	}
	if s.full() {
		os.Remove(tmp)
		fail(w, 507, tooMany)
		return
	}
	it, err := s.addFile(tmp, parent, name, numQ(q.Get("x")), numQ(q.Get("y")), r.Header.Get("Content-Type"), numQ(q.Get("mtime")))
	if err != nil {
		os.Remove(tmp)
		fail(w, 500, "Upload failed: "+err.Error())
		return
	}
	s.save()
	writeJSON(w, 200, reply(it))
}

// PUT /api/files/{id}: replace a file's content (editors)
func (a *API) replace(w http.ResponseWriter, r *http.Request) {
	s, id, n := a.s, r.PathValue("id"), r.ContentLength
	s.mu.Lock()
	it := s.db.Items[id]
	if it == nil || it.Type != "file" {
		s.mu.Unlock()
		fail(w, 404, "This file no longer exists.")
		return
	}
	if n < 0 {
		s.mu.Unlock()
		fail(w, 411, "Content-Length required")
		return
	}
	delta := n - it.size()
	if free := s.free(); delta > free {
		s.mu.Unlock()
		drain(w, r, n)
		fail(w, 413, fmt.Sprintf("Not enough space to save %q. It needs %s more, only %s is free.", it.Name, fmtBytes(delta), fmtBytes(max(0, free))))
		return
	}
	hold := max(0, delta)
	s.reserved += hold
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.reserved -= hold; s.mu.Unlock() }()

	tmp, err := a.receive(w, r, n)
	if err != nil {
		fail(w, 400, "Save failed: "+err.Error())
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if it = s.db.Items[id]; it == nil {
		os.Remove(tmp)
		fail(w, 404, "This file was deleted.")
		return
	}
	if err := os.Rename(tmp, s.blob(id)); err != nil {
		os.Remove(tmp)
		fail(w, 500, "Save failed: "+err.Error())
		return
	}
	it.Size = &n
	it.Mtime = time.Now().UnixMilli()
	it.Mime = mimeFor(it.Name, r.Header.Get("Content-Type"))
	s.save()
	writeJSON(w, 200, reply(it))
}

// GET /api/files/{id}[?inline=1][&v=mtime]
func (a *API) download(w http.ResponseWriter, r *http.Request) {
	s := a.s
	s.mu.Lock()
	it := s.db.Items[r.PathValue("id")]
	var name, typ, path string
	if it != nil && it.Type == "file" {
		name, typ, path = it.Name, it.Mime, s.blob(it.ID)
	}
	s.mu.Unlock()
	f, err := os.Open(path)
	if name == "" || err != nil {
		http.Error(w, "Not found", 404)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		http.Error(w, "Not found", 404)
		return
	}
	disp := "attachment"
	if r.URL.Query().Get("inline") == "1" {
		disp = "inline"
	}
	h := w.Header()
	h.Set("Content-Type", typ)
	h.Set("Content-Disposition", disp+"; filename*=UTF-8''"+encodeFilename(name))
	h.Set("Content-Security-Policy", "sandbox") // an uploaded HTML or SVG file can't run script as QuickDrop
	if r.URL.Query().Get("v") != "" {
		h.Set("Cache-Control", "private, max-age=31536000, immutable") // the URL changes with the content
	} else {
		h.Set("Cache-Control", "no-cache")
	}
	http.ServeContent(w, r, "", st.ModTime(), f) // handles Range, so video can seek
}

func (a *API) folder(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Parent Parent   `json:"parent"`
		Name   string   `json:"name"`
		X      *float64 `json:"x"`
		Y      *float64 `json:"y"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	s := a.s
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.validParent(body.Parent) {
		fail(w, 400, "Folder no longer exists")
		return
	}
	if s.full() {
		fail(w, 507, tooMany)
		return
	}
	it := s.addFolder(body.Parent, body.Name, num(body.X), num(body.Y))
	s.save()
	writeJSON(w, 200, reply(it))
}

// POST /api/move {moves: [{id, x?, y?, parent?}]}: all or nothing
func (a *API) move(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Moves []struct {
			ID     string          `json:"id"`
			X      *float64        `json:"x"`
			Y      *float64        `json:"y"`
			Parent json.RawMessage `json:"parent"`
		} `json:"moves"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	s := a.s
	s.mu.Lock()
	defer s.mu.Unlock()
	type undo struct {
		it     *Item
		before Item
	}
	var done []undo
	names := s.namer()
	rollback := func(msg string) {
		for i := len(done) - 1; i >= 0; i-- {
			*done[i].it = done[i].before
		}
		fail(w, 400, msg)
	}
	for _, m := range body.Moves {
		it := s.db.Items[m.ID]
		if it == nil {
			continue
		}
		done = append(done, undo{it, *it})
		if m.Parent != nil {
			var p Parent
			if json.Unmarshal(m.Parent, &p) != nil || !s.validParent(p) {
				rollback("Target folder no longer exists")
				return
			}
			if s.within(p, it.ID) {
				rollback(fmt.Sprintf("Can't move %q into itself.", it.Name))
				return
			}
			if p != it.Parent {
				it.Name = names.name(p, it.Name)
				it.Parent = p
			}
		}
		if m.X != nil {
			it.X = num(m.X)
		}
		if m.Y != nil {
			it.Y = num(m.Y)
		}
	}
	s.save()
	writeJSON(w, 200, []byte(`{"ok":true}`))
}

func (a *API) rename(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	s := a.s
	s.mu.Lock()
	defer s.mu.Unlock()
	it := s.db.Items[r.PathValue("id")]
	switch name := cleanName(body.Name); {
	case it == nil:
		fail(w, 404, "Not found")
	case s.inTrash(it.ID):
		fail(w, 400, "Restore the item from the Recycle Bin before renaming it.")
	case name == "":
		fail(w, 400, `A file name can't contain any of the following characters: \ / : * ? " < > |`)
	case s.uniqueName(it.Parent, name, it.ID) != name:
		fail(w, 409, fmt.Sprintf("There is already an item named %q here.", name))
	default:
		it.Name = name
		if it.Type == "file" {
			it.Mime = mimeFor(name, "")
		}
		s.save()
		writeJSON(w, 200, reply(it))
	}
}

// POST /api/delete {ids, permanent?}: to the Recycle Bin, unless permanent or already in it
func (a *API) delete(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs       []string `json:"ids"`
		Permanent bool     `json:"permanent"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	s := a.s
	s.mu.Lock()
	defer s.mu.Unlock()
	var permanent, toTrash []string
	candidate := map[string]bool{}
	for _, id := range body.IDs {
		if s.db.Items[id] == nil {
			continue
		}
		if body.Permanent || s.inTrash(id) {
			permanent = append(permanent, id)
		} else {
			toTrash = append(toTrash, id)
			candidate[id] = true
		}
	}
	now := time.Now().UnixMilli()
	trashed := 0
	for _, id := range toTrash {
		it := s.db.Items[id]
		inside := false // its folder goes to the bin too, and takes it along
		seen := map[Parent]bool{}
		for p := it.Parent; p != "" && !seen[p]; {
			seen[p] = true
			if candidate[string(p)] {
				inside = true
				break
			}
			up := s.db.Items[string(p)]
			if up == nil {
				break
			}
			p = up.Parent
		}
		if inside {
			continue
		}
		it.Orig = &Orig{it.Parent, it.X, it.Y}
		it.Parent = trash
		it.TrashedAt = now
		trashed++
	}
	deleted := s.remove(permanent)
	s.save()
	writeJSON(w, 200, reply(map[string]int{"trashed": trashed, "deleted": deleted}))
}

// POST /api/restore {ids?}: everything in the bin when ids is left out
func (a *API) restore(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs *[]string `json:"ids"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	s := a.s
	s.mu.Lock()
	defer s.mu.Unlock()
	var ids []string
	if body.IDs != nil {
		ids = *body.IDs
	} else {
		for _, it := range s.children(trash) {
			ids = append(ids, it.ID)
		}
	}
	restored := []*Item{}
	names := s.namer()
	for _, id := range ids {
		it := s.db.Items[id]
		if it == nil || it.Parent != trash {
			continue
		}
		var p Parent
		var x, y int64
		if it.Orig != nil {
			x, y = max(0, it.Orig.X), max(0, it.Orig.Y)
			if s.validParent(it.Orig.Parent) {
				p = it.Orig.Parent
			}
		}
		it.Name = names.name(p, it.Name)
		it.Parent, it.X, it.Y = p, x, y
		it.Orig, it.TrashedAt = nil, 0
		restored = append(restored, it)
	}
	s.save()
	writeJSON(w, 200, reply(map[string]any{"restored": restored}))
}

func (a *API) emptyTrash(w http.ResponseWriter, r *http.Request) {
	var body struct{}
	if !readJSON(w, r, &body) {
		return
	}
	s := a.s
	s.mu.Lock()
	defer s.mu.Unlock()
	var ids []string
	for _, it := range s.children(trash) {
		ids = append(ids, it.ID)
	}
	deleted := s.remove(ids)
	s.save()
	writeJSON(w, 200, reply(map[string]int{"deleted": deleted}))
}

// encodeFilename percent-encodes a name for filename*= (RFC 8187).
func encodeFilename(name string) string {
	var b strings.Builder
	for _, c := range []byte(name) {
		if 'a' <= c && c <= 'z' || 'A' <= c && c <= 'Z' || '0' <= c && c <= '9' || strings.IndexByte("!#$&+-.^_`|~", c) >= 0 {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}
