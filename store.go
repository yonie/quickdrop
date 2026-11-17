package main

// The store: one JSON index (db.json) plus one blob per file in files/.
// Every change happens under mu; save() bumps the version, writes the index
// shortly after and tells connected browsers to reload.

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

const trash = "trash" // pseudo-parent of items in the Recycle Bin

// maxItems caps files plus folders: empty files and folders cost nothing against the quota.
const maxItems = 10000

const tooMany = "QuickDrop is full: it holds at most 10,000 files and folders."

// Parent is a folder id; "" is the root and travels as JSON null.
type Parent string

func (p Parent) MarshalJSON() ([]byte, error) {
	if p == "" {
		return []byte("null"), nil
	}
	return json.Marshal(string(p))
}

func (p *Parent) UnmarshalJSON(b []byte) error {
	if string(b) == "null" {
		*p = ""
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	*p = Parent(s)
	return nil
}

type Orig struct {
	Parent Parent `json:"parent"`
	X      int64  `json:"x"`
	Y      int64  `json:"y"`
}

type Item struct {
	ID        string `json:"id"`
	Type      string `json:"type"` // "file" or "folder"
	Name      string `json:"name"`
	Parent    Parent `json:"parent"`
	X         int64  `json:"x"`
	Y         int64  `json:"y"`
	Size      *int64 `json:"size,omitempty"` // files only
	Mime      string `json:"mime,omitempty"`
	Mtime     int64  `json:"mtime"`
	Created   int64  `json:"created"`
	Orig      *Orig  `json:"orig,omitempty"` // where a trashed item came from
	TrashedAt int64  `json:"trashedAt,omitempty"`
}

func (it *Item) size() int64 {
	if it.Size == nil {
		return 0
	}
	return *it.Size
}

type Settings struct {
	Modules map[string]bool `json:"modules"`
}

type DB struct {
	Items    map[string]*Item `json:"items"`
	Settings Settings         `json:"settings"`
}

type Store struct {
	mu       sync.Mutex
	db       DB
	version  int64
	reserved int64 // bytes of uploads in flight
	quota    int64
	dir      string
	files    string
	tmp      string
	index    string
	timer    *time.Timer
	writeMu  sync.Mutex
	notify   func(int64)
}

// openStore loads the index. It refuses to start on an unreadable index rather than overwrite it.
func openStore(dir string, quota int64) (*Store, bool, error) {
	s := &Store{quota: quota, dir: dir, files: filepath.Join(dir, "files"), tmp: filepath.Join(dir, "tmp"), index: filepath.Join(dir, "db.json")}
	if err := os.MkdirAll(s.files, 0o755); err != nil {
		return nil, false, err
	}
	if err := os.MkdirAll(s.tmp, 0o755); err != nil {
		return nil, false, err
	}
	// leftovers of uploads cut off by a restart; only our own files, whatever DATA_DIR points at
	for _, pat := range []string{"up-*", "sample-*"} {
		old, _ := filepath.Glob(filepath.Join(s.tmp, pat))
		for _, f := range old {
			os.Remove(f)
		}
	}
	fresh := false
	b, err := os.ReadFile(s.index)
	switch {
	case errors.Is(err, os.ErrNotExist):
		fresh = true
	case err != nil:
		return nil, false, err
	default:
		if err := json.Unmarshal(b, &s.db); err != nil {
			return nil, false, fmt.Errorf("%s is damaged (%v); not starting, so nothing gets overwritten", s.index, err)
		}
	}
	if s.db.Items == nil {
		s.db.Items = map[string]*Item{}
	}
	if s.db.Settings.Modules == nil {
		s.db.Settings.Modules = map[string]bool{}
	}
	for id, it := range s.db.Items {
		if it.Type == "file" {
			if _, err := os.Stat(s.blob(id)); err != nil {
				delete(s.db.Items, id)
			}
		}
	}
	s.version = time.Now().UnixMilli()
	return s, fresh, nil
}

func (s *Store) blob(id string) string { return filepath.Join(s.files, id) }

// save marks a change: new version, index written 100 ms later, browsers notified. Call with mu held.
func (s *Store) save() {
	s.version++
	if s.timer == nil {
		s.timer = time.AfterFunc(100*time.Millisecond, s.flush)
	}
	if s.notify != nil {
		s.notify(s.version)
	}
}

// flush writes the index atomically (temp file, then rename).
func (s *Store) flush() {
	s.mu.Lock()
	s.timer = nil
	b, err := json.Marshal(&s.db)
	s.mu.Unlock()
	if err != nil {
		log.Print("index: ", err)
		return
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	tmp := s.index + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		log.Print("index: ", err)
		return
	}
	if err := os.Rename(tmp, s.index); err != nil {
		log.Print("index: ", err)
	}
}

func (s *Store) used() int64 {
	var n int64
	for _, it := range s.db.Items {
		n += it.size()
	}
	return n
}

func (s *Store) free() int64 { return s.quota - s.used() - s.reserved }

func (s *Store) full() bool { return len(s.db.Items) >= maxItems }

func (s *Store) inTrash(id string) bool {
	seen := map[string]bool{}
	for a := id; a != "" && !seen[a]; {
		seen[a] = true
		it := s.db.Items[a]
		if it == nil {
			return false
		}
		if it.Parent == trash {
			return true
		}
		a = string(it.Parent)
	}
	return false
}

// within reports whether folder p is id itself or lies somewhere inside it.
func (s *Store) within(p Parent, id string) bool {
	seen := map[string]bool{}
	for a := string(p); a != "" && a != trash && !seen[a]; {
		if a == id {
			return true
		}
		seen[a] = true
		it := s.db.Items[a]
		if it == nil {
			return false
		}
		a = string(it.Parent)
	}
	return false
}

func (s *Store) validParent(p Parent) bool {
	if p == "" {
		return true
	}
	it := s.db.Items[string(p)]
	return it != nil && it.Type == "folder" && !s.inTrash(it.ID)
}

func (s *Store) children(p Parent) []*Item {
	var out []*Item
	for _, it := range s.db.Items {
		if it.Parent == p {
			out = append(out, it)
		}
	}
	return out
}

// uniqueName returns name, or "name (2).ext" and so on when the folder already has it.
func (s *Store) uniqueName(p Parent, name, except string) string {
	taken := map[string]bool{}
	for _, it := range s.children(p) {
		if it.ID != except {
			taken[strings.ToLower(it.Name)] = true
		}
	}
	return pick(taken, name)
}

// namer gives unique names to many items moving at once, reading each folder only once.
type namer struct {
	s     *Store
	taken map[Parent]map[string]bool
}

func (s *Store) namer() *namer { return &namer{s, map[Parent]map[string]bool{}} }

// name returns a free name in p for an item that is not in p yet, and reserves it.
func (n *namer) name(p Parent, name string) string {
	t := n.taken[p]
	if t == nil {
		t = map[string]bool{}
		for _, it := range n.s.children(p) {
			t[strings.ToLower(it.Name)] = true
		}
		n.taken[p] = t
	}
	name = pick(t, name)
	t[strings.ToLower(name)] = true
	return name
}

func pick(taken map[string]bool, name string) string {
	if !taken[strings.ToLower(name)] {
		return name
	}
	base, ext := name, ""
	if dot := strings.LastIndex(name, "."); dot > 0 {
		base, ext = name[:dot], name[dot:]
	}
	for n := 2; ; n++ {
		c := base + " (" + strconv.Itoa(n) + ")" + ext
		if !taken[strings.ToLower(c)] {
			return c
		}
	}
}

// addFile turns a finished temp file into an item. Call with mu held, then save().
func (s *Store) addFile(tmp string, p Parent, name string, x, y int64, mime string, mtime int64) (*Item, error) {
	id := newID()
	if err := os.Rename(tmp, s.blob(id)); err != nil {
		return nil, err
	}
	st, err := os.Stat(s.blob(id))
	if err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	if mtime <= 0 {
		mtime = now
	}
	size := st.Size()
	it := &Item{ID: id, Type: "file", Parent: p, Name: s.uniqueName(p, name, ""), X: x, Y: y,
		Size: &size, Mime: mimeFor(name, mime), Mtime: mtime, Created: now}
	s.db.Items[id] = it
	return it, nil
}

func (s *Store) addFolder(p Parent, name string, x, y int64) *Item {
	if name = cleanName(name); name == "" {
		name = "New folder"
	}
	now := time.Now().UnixMilli()
	it := &Item{ID: newID(), Type: "folder", Parent: p, Name: s.uniqueName(p, name, ""), X: x, Y: y, Mtime: now, Created: now}
	s.db.Items[it.ID] = it
	return it
}

// remove deletes items and everything inside them, blobs included. Call with mu held.
func (s *Store) remove(ids []string) int {
	kids := map[Parent][]string{}
	for id, it := range s.db.Items {
		kids[it.Parent] = append(kids[it.Parent], id)
	}
	doomed := map[string]bool{}
	var collect func(id string)
	collect = func(id string) {
		if s.db.Items[id] == nil || doomed[id] {
			return
		}
		doomed[id] = true
		for _, c := range kids[Parent(id)] {
			collect(c)
		}
	}
	for _, id := range ids {
		collect(id)
	}
	for id := range doomed {
		if s.db.Items[id].Type == "file" {
			os.Remove(s.blob(id))
		}
		delete(s.db.Items, id)
	}
	return len(doomed)
}

func newID() string {
	b := make([]byte, 9)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// cleanName drops characters Windows does not allow in file names, control characters,
// and invisible or direction-changing ones that could make "photo<RLO>gpj.exe" look like a .jpg.
func cleanName(n string) string {
	n = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`\/:*?"<>|`, r) || unicode.In(r, unicode.Cc, unicode.Bidi_Control, unicode.Join_Control) ||
			r == 0x200b || r == 0x2060 || r == 0xfeff {
			return -1
		}
		return r
	}, n)
	n = strings.TrimSpace(n)
	if utf8.RuneCountInString(n) > 200 {
		n = string([]rune(n)[:200])
	}
	if strings.Trim(n, ".") == "" {
		return ""
	}
	return n
}

// num rounds a client-supplied coordinate; missing or invalid becomes 0.
func num(v *float64) int64 {
	if v == nil || math.IsNaN(*v) || math.IsInf(*v, 0) || *v < 0 {
		return 0
	}
	return int64(math.Round(*v))
}

func numQ(s string) int64 {
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return num(&f)
}

var mimeTypes = map[string]string{
	"txt": "text/plain", "md": "text/markdown", "csv": "text/csv", "log": "text/plain", "json": "application/json",
	"html": "text/html", "htm": "text/html", "css": "text/css", "js": "text/javascript", "mjs": "text/javascript", "xml": "application/xml",
	"svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp",
	"bmp": "image/bmp", "avif": "image/avif", "ico": "image/x-icon", "heic": "image/heic",
	"mp4": "video/mp4", "webm": "video/webm", "mov": "video/quicktime", "m4v": "video/x-m4v", "ogv": "video/ogg",
	"mp3": "audio/mpeg", "wav": "audio/wav", "m4a": "audio/mp4", "aac": "audio/aac", "ogg": "audio/ogg", "oga": "audio/ogg",
	"opus": "audio/opus", "flac": "audio/flac", "pdf": "application/pdf", "zip": "application/zip",
}

// mimeFor keeps the type the browser sent, or guesses one from the extension.
func mimeFor(name, given string) string {
	if len(given) > 100 {
		given = given[:100]
	}
	for _, c := range given {
		if c < 0x20 || c > 0x7e {
			given = ""
			break
		}
	}
	if given != "" && given != "application/octet-stream" {
		return given
	}
	if dot := strings.LastIndex(name, "."); dot > 0 {
		if m, ok := mimeTypes[strings.ToLower(name[dot+1:])]; ok {
			return m
		}
	}
	return "application/octet-stream"
}

// fmtBytes matches the browser's formatting: 1.5 MB, 120 KB, 900 bytes.
func fmtBytes(b int64) string {
	units := []string{"bytes", "KB", "MB", "GB"}
	f, i := float64(b), 0
	for f >= 1024 && i < len(units)-1 {
		f /= 1024
		i++
	}
	switch {
	case i == 0:
		return strconv.FormatInt(b, 10) + " bytes"
	case f < 100:
		return strconv.FormatFloat(math.Round(f*10)/10, 'f', -1, 64) + " " + units[i]
	default:
		return strconv.FormatFloat(math.Round(f), 'f', -1, 64) + " " + units[i]
	}
}
