package proxy

import (
	"errors"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/alepha/bay/internal/headers"
	"github.com/alepha/bay/internal/naming"
	"github.com/alepha/bay/internal/state"
)

// defaultCacheControl is what Cloudflare answers for a file no `_headers` rule
// caches, and so what Bay answers once a release ships a `_headers`: the same
// meaning as the `no-cache` it sends without one, and the same bytes as every
// other host of the same artifact.
const defaultCacheControl = "public, max-age=0, must-revalidate"

// configFiles are read as configuration by a host, never served: Cloudflare
// hides them, and so does Bay, whether or not the release has a `_headers`.
var configFiles = map[string]bool{
	"/_headers":      true,
	"/_redirects":    true,
	"/.assetsignore": true,
}

// isConfigFile reports whether a cleaned request path names one of configFiles.
func isConfigFile(clean string) bool {
	return configFiles[clean]
}

// releaseHeaders is one release's `_headers`, parsed once.
//
// A release never changes after it is placed, so its rules are read on the
// first request that needs them and kept, keyed by release directory. That is
// what covers a Bay restart and a rollback (SwapRelease), neither of which runs
// the deploy's own check.
type releaseHeaders struct {
	once    sync.Once
	rules   []headers.Rule
	present bool
}

// headerCache holds every release's rules that have been read.
type headerCache struct {
	mu        sync.Mutex
	byRelease map[string]*releaseHeaders
}

// rulesFor returns the current release's rules for app, and whether it has a
// `_headers` that parses.
//
// A file that does not parse here can only be a release placed by a Bay older
// than the deploy check: it is treated as absent, so the hashedAsset regex
// applies as it did before, and logged once. It is still never served.
func (p *Proxy) rulesFor(app state.App) ([]headers.Rule, bool) {
	dir := filepath.Join(p.root, "apps", naming.Instance(app.Name, app.Env), "releases", app.Release, "dist", "public")

	p.headerCache.mu.Lock()
	if p.headerCache.byRelease == nil {
		p.headerCache.byRelease = map[string]*releaseHeaders{}
	}
	entry := p.headerCache.byRelease[dir]
	if entry == nil {
		entry = &releaseHeaders{}
		p.headerCache.byRelease[dir] = entry
	}
	p.headerCache.mu.Unlock()

	entry.once.Do(func() {
		file := filepath.Join(dir, "_headers")
		body, err := os.ReadFile(file)
		if err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				p.log.Warn("_headers could not be read; serving the release as if it had none",
					"app", app.Key(), "release", app.Release, "err", err)
			}
			return
		}
		rules, err := headers.Read(string(body), file)
		if err != nil {
			p.log.Warn("_headers does not parse; serving the release as if it had none",
				"app", app.Key(), "release", app.Release, "err", err)
			return
		}
		entry.rules, entry.present = rules, true
	})
	return entry.rules, entry.present
}

// rulesWriter applies `_headers` rules at the last moment a header can still
// change: when the status is written.
//
// Cloudflare applies the rules on top of every header the host set, so they
// are applied here after http.ServeFile has set its own (Content-Type,
// Last-Modified, the 304 path's deletions), not before it runs.
type rulesWriter struct {
	http.ResponseWriter
	rules   []headers.Rule
	path    string
	applied bool
}

func (w *rulesWriter) apply() {
	if w.applied {
		return
	}
	w.applied = true
	headers.Apply(w.rules, w.path, w.Header())
}

func (w *rulesWriter) WriteHeader(status int) {
	w.apply()
	w.ResponseWriter.WriteHeader(status)
}

func (w *rulesWriter) Write(b []byte) (int, error) {
	w.apply()
	return w.ResponseWriter.Write(b)
}

// ReadFrom keeps the underlying writer's sendfile path, which http.ServeFile
// takes through io.Copy, once the rules are applied.
func (w *rulesWriter) ReadFrom(src io.Reader) (int64, error) {
	w.apply()
	if rf, ok := w.ResponseWriter.(io.ReaderFrom); ok {
		return rf.ReadFrom(src)
	}
	return io.Copy(w.ResponseWriter, src)
}

// Unwrap lets http.ResponseController reach the connection underneath.
func (w *rulesWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

// withRules sets Bay's default for a file served from disk and returns the
// writer to serve it through.
//
// With a `_headers` in the app's current release: Cloudflare's default
// Cache-Control, and the rules applied on top, matched against the request's
// path as received, percent-encoded (Cloudflare reads
// `new URL(request.url).pathname`), never the file found: `/changelog` served
// from `changelog.html` matches `/changelog`, and a miss answered with
// `404.html` matches the missed path. r.URL.Path is decoded and would disagree
// with Cloudflare on any encoded path.
//
// Without one, the release is served as it always was: `fallback` as the
// Cache-Control.
func (p *Proxy) withRules(w http.ResponseWriter, r *http.Request, app state.App, fallback string) http.ResponseWriter {
	rules, present := p.rulesFor(app)
	if !present {
		w.Header().Set("Cache-Control", fallback)
		return w
	}
	w.Header().Set("Cache-Control", defaultCacheControl)
	return &rulesWriter{ResponseWriter: w, rules: rules, path: r.URL.EscapedPath()}
}

// hashedCacheControl is the Cache-Control of a release with no `_headers`: a
// year for a content-addressed name, revalidation for everything else.
func hashedCacheControl(path string) string {
	if hashedAsset.MatchString(filepath.Base(strings.TrimSuffix(path, "/"))) {
		return "public, max-age=31536000, immutable"
	}
	return "no-cache"
}
