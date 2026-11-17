// QuickDrop: an Explorer-style shared drop zone for your home network.
// One binary with the web app built in; files live in DATA_DIR.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

//go:embed public modules samples
var assets embed.FS

// The page may only load its own code; uploaded files get their own stricter policy.
const csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; font-src 'self' data:; " +
	"frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

type Module struct {
	ID          string `json:"-"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Icon        string `json:"icon"`
	Order       int    `json:"order"`
	Default     *bool  `json:"default"`
	HasCSS      bool   `json:"-"`
}

type asset struct {
	data  []byte
	etag  string
	ctype string
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	port := env("PORT", "3030")
	quotaMB, err := strconv.ParseFloat(env("QUOTA_MB", "100"), 64)
	if err != nil || quotaMB <= 0 {
		log.Fatal("QUOTA_MB must be a positive number")
	}
	store, fresh, err := openStore(env("DATA_DIR", "data"), int64(quotaMB*1024*1024))
	if err != nil {
		log.Fatal(err)
	}
	api := &API{s: store, modules: loadModules(), clients: map[chan int64]struct{}{}}
	store.notify = api.broadcast
	if fresh && os.Getenv("SAMPLES") != "0" {
		addSamples(store)
	}

	mux := http.NewServeMux()
	api.routes(mux)
	files := loadAssets("public")
	mods := loadAssets("modules")
	mux.HandleFunc("GET /modules/{id}/{file}", func(w http.ResponseWriter, r *http.Request) {
		f := r.PathValue("file")
		if f != "client.js" && f != "client.css" {
			http.NotFound(w, r)
			return
		}
		serveAsset(w, r, mods, "/"+r.PathValue("id")+"/"+f, "no-cache")
	})
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if strings.HasPrefix(p, "/api/") {
			fail(w, 404, "Not found")
			return
		}
		if p == "/" {
			p = "/index.html"
		}
		cache := "no-cache"
		if strings.HasPrefix(p, "/vendor/") {
			cache = "public, max-age=604800"
		}
		serveAsset(w, r, files, p, cache)
	})

	// Refuse state-changing requests from other websites (Sec-Fetch-Site / Origin checks).
	handler := hostGuard(env("ALLOWED_HOSTS", ""), http.NewCrossOriginProtection().Handler(headers(mux)))
	srv := &http.Server{Addr: ":" + port, Handler: handler, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		srv.Shutdown(sctx) // live-update streams never end by themselves; the timeout cuts them
	}()
	names := make([]string, len(api.modules))
	for i, m := range api.modules {
		names[i] = m.ID
	}
	log.Printf("quickdrop listening on :%s, data %s, quota %s, modules: %s", port, store.dir, fmtBytes(store.quota), strings.Join(names, ", "))
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal(err)
	}
	store.flush()
}

// hostGuard stops DNS rebinding: a website that points its own name at QuickDrop's
// address would otherwise count as same-origin and could read and delete everything.
// Addresses, localhost, single names (nas) and home-network names (.local, .lan,
// .home.arpa, .internal) always work; any other name must be listed in ALLOWED_HOSTS.
func hostGuard(list string, next http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, h := range strings.Split(list, ",") {
		if h = strings.ToLower(strings.TrimSpace(h)); h != "" {
			allowed[h] = true
		}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Host
		if hh, _, err := net.SplitHostPort(h); err == nil {
			h = hh
		}
		h = strings.ToLower(strings.TrimSuffix(strings.Trim(h, "[]"), "."))
		if !allowed["*"] && !allowed[h] && !homeHost(h) {
			http.Error(w, "QuickDrop does not answer to "+h+". Add it to ALLOWED_HOSTS.", http.StatusMisdirectedRequest)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func homeHost(h string) bool {
	if net.ParseIP(h) != nil || h == "localhost" || !strings.Contains(h, ".") {
		return true
	}
	for _, suffix := range []string{".localhost", ".local", ".lan", ".home.arpa", ".internal"} {
		if strings.HasSuffix(h, suffix) {
			return true
		}
	}
	return false
}

// headers adds the security headers every response carries.
func headers(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", csp)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}

// loadAssets reads an embedded folder into memory with an ETag per file.
func loadAssets(root string) map[string]asset {
	out := map[string]asset{}
	fs.WalkDir(assets, root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := assets.ReadFile(p)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(b)
		ctype := mime.TypeByExtension(path.Ext(p))
		switch path.Ext(p) {
		case ".js", ".mjs":
			ctype = "text/javascript; charset=utf-8"
		case "":
			ctype = "text/plain; charset=utf-8" // LICENSE files
		}
		out[strings.TrimPrefix(p, root)] = asset{b, `"` + hex.EncodeToString(sum[:8]) + `"`, ctype}
		return nil
	})
	return out
}

func serveAsset(w http.ResponseWriter, r *http.Request, set map[string]asset, p, cache string) {
	a, ok := set[p]
	if !ok {
		http.NotFound(w, r)
		return
	}
	h := w.Header()
	h.Set("Content-Type", a.ctype)
	h.Set("ETag", a.etag)
	h.Set("Cache-Control", cache)
	http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(a.data))
}

// loadModules reads modules/<id>/module.json, sorted by order.
func loadModules() []Module {
	var mods []Module
	dirs, _ := assets.ReadDir("modules")
	for _, d := range dirs {
		if !d.IsDir() {
			continue
		}
		b, err := assets.ReadFile("modules/" + d.Name() + "/module.json")
		m := Module{Order: 100}
		if err != nil || json.Unmarshal(b, &m) != nil {
			log.Printf("module %s: no valid module.json, skipped", d.Name())
			continue
		}
		m.ID = d.Name()
		_, err = fs.Stat(assets, "modules/"+d.Name()+"/client.css")
		m.HasCSS = err == nil
		mods = append(mods, m)
	}
	sort.Slice(mods, func(i, j int) bool {
		if mods[i].Order != mods[j].Order {
			return mods[i].Order < mods[j].Order
		}
		return mods[i].ID < mods[j].ID
	})
	return mods
}

// addSamples gives a new install a few files to try things on.
func addSamples(s *Store) {
	var list []struct {
		File string
		X, Y int64
	}
	b, _ := assets.ReadFile("samples/samples.json")
	if err := json.Unmarshal(b, &list); err != nil {
		log.Print("samples: ", err)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, f := range list {
		data, err := assets.ReadFile("samples/" + f.File)
		if err != nil {
			log.Print("samples: ", err)
			continue
		}
		tmp, err := os.CreateTemp(s.tmp, "sample-")
		if err == nil {
			_, err = tmp.Write(data)
			tmp.Close()
		}
		if err == nil {
			_, err = s.addFile(tmp.Name(), "", f.File, f.X, f.Y, "", 0)
		}
		if err != nil {
			log.Print("samples: ", err)
		}
	}
	s.save()
	log.Printf("first run: added %d sample files", len(list))
}
