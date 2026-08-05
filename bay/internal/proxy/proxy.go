// Package proxy is the front door: host-based routing, static assets, and the
// reverse proxy to app processes.
package proxy

import (
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/alepha/bay/internal/state"
)

// Proxy routes incoming requests to the right app.
type Proxy struct {
	root  string
	store *state.Store
	log   *slog.Logger
	// holds names the apps Bay is deliberately restarting; requests for those
	// wait for the new process instead of getting a 502. See hold.go.
	holds holdSet
	// tr is the connection pool to the apps, owned so that dropping idle
	// connections at the start of a deploy affects nothing else.
	transportOnce sync.Once
	tr            *http.Transport
	// seen accumulates when each app last answered, drained to the store on a
	// ticker so the request path never writes to disk. See lastseen.go.
	seen lastSeen
}

// DrainLastSeen returns the traffic recorded since the previous call, and
// clears it. Called by the flush loop in cmd/bay, never on the request path.
func (p *Proxy) DrainLastSeen() map[string]time.Time {
	return p.seen.drain()
}

func New(root string, store *state.Store, log *slog.Logger) *Proxy {
	return &Proxy{root: root, store: store, log: log}
}

func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	host := r.Host
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}

	app, ok := p.store.ByDomain(host)
	if !ok {
		http.Error(w, "no app registered for host "+host, http.StatusNotFound)
		return
	}

	// Operational endpoints are loopback-only.
	//
	// `/health` says whether an app has finished migrating and `/metrics`
	// describes its heap, its event loop and its per-route latency. Bay reads
	// both over loopback, which is the only place they are of any use — served
	// on the public host they hand a stranger a live readout of how to time an
	// attack, and a free way to tell whether one landed.
	//
	// 404 rather than 403: the difference between "you may not" and "there is
	// nothing here" is a difference an attacker can act on.
	if isOperational(r.URL.Path) {
		http.NotFound(w, r)
		return
	}

	// file-first, fallback app. One rule that covers assets, prerendered HTML,
	// favicon, the PWA manifest and the service worker — and it is what keeps
	// scale-to-zero viable, since a page pulls 10-30 asset requests that must
	// never wake a sleeping process.
	if path, ok := p.findStatic(app, r.URL.Path); ok {
		// Counted without inspecting the response: findStatic has already
		// stat'd the file, so what follows is a 200, a 304 or a range — all of
		// them somebody reading this app. This is also the only place the
		// traffic could be seen at all, since a page served entirely from disk
		// never reaches the app process to be counted there.
		p.seen.touch(app.Key(), time.Now())
		p.serveStatic(w, r, path)
		return
	}
	// A static site has no process to forward to: the fallback files the build
	// wrote ARE the rest of its routing table.
	if app.Static {
		p.seen.touch(app.Key(), time.Now())
		p.serveFallback(w, r, app)
		return
	}
	p.forward(w, r, app)
}

// serveFallback answers a request for a static site that matched no file.
//
// Two files, both emitted by `alepha build --target=static`, in this order:
//
//   - 200.html — the SPA shell, served with status 200. A client-routed app
//     resolves the path itself, and answering 404 would have search engines drop
//     the page and `fetch` treat it as an error.
//   - 404.html — a genuinely missing page, served with status 404. The status
//     matters as much as the body: a soft 404 is indexed.
func (p *Proxy) serveFallback(w http.ResponseWriter, r *http.Request, app state.App) {
	// Only an extensionless path can be a client route. A missing `.js` chunk
	// handed the SPA shell becomes a syntax error in the console, which is a
	// much longer walk back to "that file was not deployed".
	if filepath.Ext(cleanPath(r.URL.Path)) == "" {
		if shell, ok := p.findStatic(app, "/200.html"); ok {
			p.serveStatic(w, r, shell)
			return
		}
	}
	if notFound, ok := p.findStatic(app, "/404.html"); ok {
		p.serveStatusPage(w, notFound, http.StatusNotFound)
		return
	}
	http.NotFound(w, r)
}

// serveStatusPage writes a file under a status other than 200.
//
// Not http.ServeFile, which always answers 200 — the whole point of the 404
// page is the status code. Range requests and precompressed sidecars are given
// up deliberately: this path serves one small document on a request that has
// already missed everything else.
func (p *Proxy) serveStatusPage(w http.ResponseWriter, path string, status int) {
	body, err := os.ReadFile(path)
	if err != nil {
		// It was stat'd a moment ago, so this is a race with a prune or a disk
		// error. Either way the request is over.
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(status)
	if _, err := w.Write(body); err != nil {
		p.log.Debug("writing status page failed", "path", path, "err", err)
	}
}

// findStatic looks for a file across ALL retained releases, not just current.
//
// During a deploy a client still holds an HTML page referencing the previous
// hashed chunk. If only `current` were served, that request 404s and the user
// gets a white screen. Hashed names make collisions impossible, so searching
// every retained release is safe and removes the whole failure class.
func (p *Proxy) findStatic(app state.App, urlPath string) (string, bool) {
	clean := cleanPath(urlPath)
	if clean == "/" {
		clean = "/index.html"
	}

	names := []string{clean}
	// A static site has no process to render the routes its build wrote to disk.
	// Alepha's prerender emits them FLAT — `${dist}${pathname}.html`, so
	// `/changelog` is `changelog.html` — and an exact-path stat finds nothing at
	// all. Without this probe every page but the root would 404 on a site whose
	// pages are all sitting right there. The directory-index probe after it
	// costs one more stat on a path that has already missed twice, and covers
	// generators that nest instead of flattening.
	//
	// Gated on Static: a process app answers these routes itself, so for it the
	// extra stats would be pure cost on the hot path.
	if app.Static && filepath.Ext(clean) == "" {
		names = append(names, clean+".html", filepath.Join(clean, "index.html"))
	}

	instance := filepath.Join(p.root, "apps", app.Name, app.Env)
	for _, release := range p.releases(instance, app.Release) {
		// The Alepha build emits client assets at dist/public — served from
		// there directly rather than hoisted into the archive root, which would
		// mean moving hundreds of files at packaging time for no gain.
		base := filepath.Join(instance, "releases", release, "dist", "public")
		for _, name := range names {
			candidate := filepath.Join(base, name)
			// Defence in depth: Clean above already strips ../, but a symlinked
			// public/ could still point outside.
			if !strings.HasPrefix(candidate, base+string(os.PathSeparator)) && candidate != base {
				continue
			}
			if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
				return candidate, true
			}
		}
	}
	return "", false
}

// cleanPath normalises a request path for use under the served root.
//
// Shared by the lookup and the fallback so the extension test and the file
// lookup can never disagree about what the path is.
func cleanPath(urlPath string) string {
	return filepath.Clean("/" + strings.TrimPrefix(urlPath, "/"))
}

// releases lists retained releases, current first.
func (p *Proxy) releases(instance, current string) []string {
	entries, err := os.ReadDir(filepath.Join(instance, "releases"))
	if err != nil {
		return nil
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() && e.Name() != current {
			names = append(names, e.Name())
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(names)))
	return append([]string{current}, names...)
}

// hashedAsset matches Vite's content-addressed output: name.HASH.ext, with an
// 8-character hash, optionally followed by a precompressed suffix.
//
// Keyed on the filename rather than an "/assets/" URL prefix: the Alepha build
// emits these flat at the web root (/entry.DyJ8G-7l.js), so a prefix rule would
// never fire and every asset would be served no-cache.
var hashedAsset = regexp.MustCompile(`\.[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+(\.(br|gz))?$`)

// encodings maps an Accept-Encoding token to the sidecar suffix produced by the
// build's compress step.
var encodings = []struct{ token, suffix string }{
	{"br", ".br"},
	{"gzip", ".gz"},
}

func (p *Proxy) serveStatic(w http.ResponseWriter, r *http.Request, path string) {
	// Content-addressed names can be cached forever. Everything else must
	// revalidate, otherwise a rollback is never visible to clients still
	// holding the previous HTML.
	if hashedAsset.MatchString(filepath.Base(path)) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}

	// The build already emitted .br/.gz sidecars; serving them saves recompressing
	// on every request. Content-Type must be set from the ORIGINAL name, since
	// ServeFile would otherwise infer it from the .br suffix.
	accept := r.Header.Get("Accept-Encoding")
	w.Header().Add("Vary", "Accept-Encoding")
	for _, enc := range encodings {
		if !strings.Contains(accept, enc.token) {
			continue
		}
		sidecar := path + enc.suffix
		info, err := os.Stat(sidecar)
		if err != nil || info.IsDir() {
			continue
		}
		if ctype := mime.TypeByExtension(filepath.Ext(path)); ctype != "" {
			w.Header().Set("Content-Type", ctype)
		}
		w.Header().Set("Content-Encoding", enc.token)
		http.ServeFile(w, r, sidecar)
		return
	}
	http.ServeFile(w, r, path)
}

func (p *Proxy) forward(w http.ResponseWriter, r *http.Request, app state.App) {
	target := &url.URL{Scheme: "http", Host: net.JoinHostPort("127.0.0.1", itoa(app.Port))}
	rp := httputil.NewSingleHostReverseProxy(target)

	// Tell the app what the CLIENT asked for, not what we are dialling.
	//
	// Bay terminates TLS and forwards over plain loopback, so without these an
	// app building an absolute URL emits `http://` and its own hostname is
	// `127.0.0.1:<port>`. That is not cosmetic: an OAuth server advertises its
	// endpoints by absolute URL, so discovery hands clients a cleartext address
	// for the one exchange that must never be cleartext.
	//
	// `NewSingleHostReverseProxy` sets `X-Forwarded-For` and nothing else, and
	// Alepha reads the rest when `TRUST_PROXY` is on — which is the default.
	inner := rp.Director
	rp.Director = func(req *http.Request) {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		// Overwritten, never appended: these come from the outside world and a
		// client that sends its own must not be able to make an app believe a
		// request arrived over TLS when it did not.
		req.Header.Set("X-Forwarded-Proto", scheme)
		req.Header.Set("X-Forwarded-Host", r.Host)

		/*
			One id per request, minted here.

			Alepha's router already reads this header — `getContextId` takes
			`x-request-id`, then `x-correlation-id`, then gives up and generates
			a UUID — and its doc recommends "a proxy that sets a consistent
			request ID header for better traceability across services". Bay is
			that proxy. Without this every app invented its own id, so nothing
			Bay knows about a request could be joined to what the app logged
			about it.

			Set for the same reason and on the same terms as the two headers
			above: OVERWRITTEN. `getContextId` says it trusts this header
			because everything is behind a proxy, which is only true if the
			proxy actually sets it. Passed through, a client could pin all its
			traffic to one id, or borrow somebody else's, and the field an
			operator greps by would be chosen by the person being investigated.
		*/
		req.Header.Set("X-Request-Id", newRequestID())
		inner(req)
	}

	rp.Transport = holdTransport{
		base:     p.transport(),
		holding:  func() bool { return p.holding(app.Key()) },
		interval: 200 * time.Millisecond,
	}

	/*
		Traffic is recorded here rather than by wrapping the ResponseWriter, and
		that choice is load bearing.

		A wrapper only forwards the methods it declares. `httputil.ReverseProxy`
		asks the writer for `http.Flusher` to stream a response as it arrives —
		Alepha's SSR flushes the document head early, so losing it would buffer
		the very thing that makes first paint fast — and for `http.Hijacker` to
		complete a websocket upgrade, which it refuses outright against a writer
		that lacks it. Both failures are silent at compile time and invisible in
		tests that only assert status codes.

		`ModifyResponse` sees the status without touching the writer at all, and
		it runs for a 101 too, so a websocket handshake counts as the use it is.
		It must never return an error: that would route a perfectly good response
		into ErrorHandler and turn it into a 502.
	*/
	rp.ModifyResponse = func(res *http.Response) error {
		if countsAsTraffic(res.StatusCode) {
			p.seen.touch(app.Key(), time.Now())
		}
		return nil
	}

	rp.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		p.log.Error("upstream unreachable", "app", app.Key(), "port", app.Port, "err", err)
		http.Error(w, "app unavailable", http.StatusBadGateway)
	}
	rp.ServeHTTP(w, r)
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var buf [12]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = byte('0' + i%10)
		i /= 10
	}
	return string(buf[pos:])
}

/*
isOperational reports whether a path is one Bay consumes rather than a
visitor.

Exact matches only. A prefix test would swallow an app's own `/metrics-guide`
or `/healthcare`, and silently 404ing a real page is worse than exposing the
two paths it protects.
*/
func isOperational(path string) bool {
	switch path {
	case "/health", "/healthz", "/metrics":
		return true
	}
	return false
}

// newRequestID returns an id for one request.
//
// 16 random bytes, hex. Not a UUID: nothing parses this, it only has to be
// unique enough to grep by and short enough to read in a terminal — and
// `crypto/rand` is already the source Bay uses for values that must not
// collide.
//
// A failure to read randomness is not worth failing a request over: the header
// is for correlation, so an empty one costs a join, not an outage. Alepha then
// mints its own id exactly as it did before this existed.
func newRequestID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return ""
	}
	return hex.EncodeToString(b[:])
}
