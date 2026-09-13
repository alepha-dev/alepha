package proxy

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/alepha/bay/internal/naming"
	"github.com/alepha/bay/internal/state"
)

// siteHeaders is the `_headers` the build writes for an Alepha site, trimmed
// to what these tests read.
const siteHeaders = `/*
  X-Frame-Options: SAMEORIGIN
  X-Content-Type-Options: nosniff

/changelog
  X-Page: changelog

/app/*
  X-Route: app

/nope
  X-Missing: nope

/caf%C3%A9.txt
  X-Encoded: yes

/entry.*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
`

// releasesSite lays out several releases of one static app and serves
// `current`. Each release is a map of dist/public paths to contents.
func releasesSite(t *testing.T, releases map[string]map[string]string, current string, logs *logRecorder) (*Proxy, *state.Store) {
	t.Helper()
	root := t.TempDir()
	store, err := state.Open(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	app := state.App{
		Name:    "docs",
		Env:     "production",
		Domains: []string{"docs.bay.localhost"},
		Release: current,
		Runtime: "static",
		Static:  true,
	}
	if err := store.Upsert(app); err != nil {
		t.Fatal(err)
	}
	for release, files := range releases {
		base := filepath.Join(root, "apps", naming.Instance("docs", "production"), "releases", release, "dist", "public")
		for name, body := range files {
			path := filepath.Join(base, name)
			if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	log := slog.New(slog.DiscardHandler)
	if logs != nil {
		log = slog.New(logs)
	}
	return New(root, store, log), store
}

// fetch asks the proxy for a path with the given request headers.
func fetch(t *testing.T, p *Proxy, path string, header http.Header) *http.Response {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "http://docs.bay.localhost"+path, nil)
	for name, values := range header {
		req.Header[name] = values
	}
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, req)
	return rec.Result()
}

func TestHeadersApplyOnTopOfBaysOwnToAHashedChunk(t *testing.T) {
	p, _ := releasesSite(t, map[string]map[string]string{"r1": {
		"_headers":          siteHeaders,
		"index.html":        "home",
		"entry.AbCd1234.js": "export {};",
		"favicon.svg":       "<svg/>",
	}}, "r1", nil)

	chunk := fetch(t, p, "/entry.AbCd1234.js", nil)
	icon := fetch(t, p, "/favicon.svg", nil)

	if got := chunk.Header.Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("chunk Cache-Control = %q", got)
	}
	if got := chunk.Header.Get("X-Frame-Options"); got != "SAMEORIGIN" {
		t.Errorf("chunk X-Frame-Options = %q", got)
	}
	if got := chunk.Header.Get("Content-Type"); !strings.Contains(got, "javascript") {
		t.Errorf("chunk Content-Type = %q, Bay's own header lost", got)
	}
	if got := icon.Header.Get("Cache-Control"); got != "public, max-age=0, must-revalidate" {
		t.Errorf("a file no rule caches got Cache-Control %q", got)
	}
}

func TestHeadersMatchTheRequestNeverTheFileFound(t *testing.T) {
	p, _ := releasesSite(t, map[string]map[string]string{"r1": {
		"_headers":       siteHeaders,
		"index.html":     "home",
		"changelog.html": "changelog",
		"200.html":       "shell",
	}}, "r1", nil)

	page := fetch(t, p, "/changelog", nil)
	shell := fetch(t, p, "/app/settings", nil)

	if got := page.Header.Get("X-Page"); got != "changelog" {
		t.Errorf("/changelog served from changelog.html: X-Page = %q", got)
	}
	if shell.StatusCode != http.StatusOK || shell.Header.Get("X-Route") != "app" {
		t.Errorf("the SPA shell for /app/settings: %d, X-Route = %q", shell.StatusCode, shell.Header.Get("X-Route"))
	}
}

func TestHeadersApplyToTheNotFoundPageByTheMissedPath(t *testing.T) {
	p, _ := releasesSite(t, map[string]map[string]string{"r1": {
		"_headers":   siteHeaders,
		"index.html": "home",
		"404.html":   "missing",
	}}, "r1", nil)

	res := fetch(t, p, "/nope", nil)

	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("status %d, want 404", res.StatusCode)
	}
	if res.Header.Get("X-Missing") != "nope" || res.Header.Get("X-Frame-Options") != "SAMEORIGIN" {
		t.Errorf("404.html for /nope carries %v", res.Header)
	}
	if got := res.Header.Get("Cache-Control"); got != "public, max-age=0, must-revalidate" {
		t.Errorf("404.html Cache-Control = %q", got)
	}
}

func TestHeadersMatchThePercentEncodedPath(t *testing.T) {
	p, _ := releasesSite(t, map[string]map[string]string{"r1": {
		"_headers":   siteHeaders,
		"index.html": "home",
		"café.txt":   "encoded",
	}}, "r1", nil)

	res := fetch(t, p, "/caf%C3%A9.txt", nil)

	if res.StatusCode != http.StatusOK || res.Header.Get("X-Encoded") != "yes" {
		t.Errorf("/caf%%C3%%A9.txt: %d, X-Encoded = %q", res.StatusCode, res.Header.Get("X-Encoded"))
	}
}

func TestHeadersApplyToA304(t *testing.T) {
	p, _ := releasesSite(t, map[string]map[string]string{"r1": {
		"_headers":          siteHeaders,
		"index.html":        "home",
		"entry.AbCd1234.js": "export {};",
	}}, "r1", nil)
	first := fetch(t, p, "/entry.AbCd1234.js", nil)

	again := fetch(t, p, "/entry.AbCd1234.js", http.Header{
		"If-Modified-Since": {first.Header.Get("Last-Modified")},
	})

	if again.StatusCode != http.StatusNotModified {
		t.Fatalf("status %d, want 304", again.StatusCode)
	}
	if got := again.Header.Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("304 Cache-Control = %q", got)
	}
}

func TestHeadersApplyToAPrecompressedSidecar(t *testing.T) {
	p, _ := releasesSite(t, map[string]map[string]string{"r1": {
		"_headers":             siteHeaders,
		"index.html":           "home",
		"entry.AbCd1234.js":    "export {};",
		"entry.AbCd1234.js.br": "brotli",
	}}, "r1", nil)

	res := fetch(t, p, "/entry.AbCd1234.js", http.Header{"Accept-Encoding": {"br"}})

	if res.Header.Get("Content-Encoding") != "br" {
		t.Fatalf("the sidecar was not served: %v", res.Header)
	}
	if got := res.Header.Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("sidecar Cache-Control = %q", got)
	}
}

func TestHeadersOfTheCurrentReleaseApplyToAFileFromAnOlderOne(t *testing.T) {
	// A page still open from before the deploy asks for its own chunk, found
	// only in the previous release. The rules that answer are the current
	// release's.
	p, _ := releasesSite(t, map[string]map[string]string{
		"r1": {"index.html": "old", "entry.OldOld12.js": "old", "_headers": "/entry.*\n  X-Release: r1\n"},
		"r2": {"index.html": "new", "_headers": "/entry.*\n  X-Release: r2\n"},
	}, "r2", nil)

	res := fetch(t, p, "/entry.OldOld12.js", nil)

	if res.StatusCode != http.StatusOK || res.Header.Get("X-Release") != "r2" {
		t.Errorf("%d, X-Release = %q, want r2", res.StatusCode, res.Header.Get("X-Release"))
	}
}

func TestHeadersFollowARollback(t *testing.T) {
	// Rules are cached per release, so switching `current` switches them, with
	// no deploy check having run.
	p, store := releasesSite(t, map[string]map[string]string{
		"r1": {"index.html": "old", "_headers": "/*\n  X-Release: r1\n"},
		"r2": {"index.html": "new", "_headers": "/*\n  X-Release: r2\n"},
	}, "r2", nil)
	if got := fetch(t, p, "/", nil).Header.Get("X-Release"); got != "r2" {
		t.Fatalf("before the rollback X-Release = %q", got)
	}

	app, _ := store.Get("docs/production")
	app.Release = "r1"
	if err := store.Upsert(app); err != nil {
		t.Fatal(err)
	}

	if got := fetch(t, p, "/", nil).Header.Get("X-Release"); got != "r1" {
		t.Errorf("after the rollback X-Release = %q, want r1", got)
	}
}

func TestConfigFilesAreNeverServed(t *testing.T) {
	// Not as a file, and not as the SPA shell either: an extensionless path
	// that is configuration answers the 404 page.
	p, _ := releasesSite(t, map[string]map[string]string{"r1": {
		"_headers":      siteHeaders,
		"_redirects":    "/old /new 301",
		".assetsignore": "*.map",
		"index.html":    "home",
		"200.html":      "shell",
		"404.html":      "missing",
	}}, "r1", nil)

	for _, path := range []string{"/_headers", "/_redirects", "/.assetsignore", "/%5Fheaders"} {
		res := fetch(t, p, path, nil)
		if res.StatusCode != http.StatusNotFound {
			t.Errorf("%s answered %d, want 404", path, res.StatusCode)
		}
	}
}

func TestWithoutHeadersTheHashedAssetRegexStillApplies(t *testing.T) {
	// A release deployed before Bay applied `_headers` must not regress.
	p, _ := releasesSite(t, map[string]map[string]string{"r1": {
		"index.html":        "home",
		"entry.AbCd1234.js": "export {};",
	}}, "r1", nil)

	chunk := fetch(t, p, "/entry.AbCd1234.js", nil)
	page := fetch(t, p, "/", nil)

	if got := chunk.Header.Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("chunk Cache-Control = %q", got)
	}
	if got := page.Header.Get("Cache-Control"); got != "no-cache" {
		t.Errorf("page Cache-Control = %q", got)
	}
}

func TestAHeadersFileThatDoesNotParseAtServeTimeIsAbsentAndLoggedOnce(t *testing.T) {
	// Only a release placed by a Bay older than the deploy check can get
	// here. Served as it was before, the file itself still hidden.
	logs := &logRecorder{}
	p, _ := releasesSite(t, map[string]map[string]string{"r1": {
		"_headers":          "/movies/:title\n  X-A: b\n",
		"index.html":        "home",
		"entry.AbCd1234.js": "export {};",
	}}, "r1", logs)

	for range 3 {
		chunk := fetch(t, p, "/entry.AbCd1234.js", nil)
		if got := chunk.Header.Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
			t.Errorf("chunk Cache-Control = %q, want the regex's", got)
		}
	}
	if res := fetch(t, p, "/_headers", nil); res.StatusCode != http.StatusNotFound {
		t.Errorf("/_headers answered %d", res.StatusCode)
	}
	if n := logs.count("_headers does not parse"); n != 1 {
		t.Errorf("logged %d times, want once", n)
	}
}

// logRecorder is a slog handler that keeps every message.
type logRecorder struct {
	mu       sync.Mutex
	messages bytes.Buffer
}

func (l *logRecorder) Enabled(context.Context, slog.Level) bool { return true }

func (l *logRecorder) Handle(_ context.Context, r slog.Record) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.messages.WriteString(r.Message + "\n")
	return nil
}

func (l *logRecorder) WithAttrs([]slog.Attr) slog.Handler { return l }

func (l *logRecorder) WithGroup(string) slog.Handler { return l }

func (l *logRecorder) count(message string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return strings.Count(l.messages.String(), message)
}
