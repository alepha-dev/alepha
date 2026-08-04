package proxy

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/alepha/bay/internal/state"
)

// staticSite lays out a deployed static release the way `alepha build
// --target=static` shapes it, and returns a proxy serving it.
//
// The filenames are not invented: they are what BuildPrerenderTask actually
// emits — `${dist}${pathname === "/" ? "/index" : pathname}.html` — verified
// against apps/docs, whose 303 pages land as `changelog.html` and
// `docs/<slug>.html`, flat, with no directory indexes anywhere.
func staticSite(t *testing.T, files map[string]string) *Proxy {
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
		Release: "r1",
		Runtime: "static",
		Static:  true,
	}
	if err := store.Upsert(app); err != nil {
		t.Fatal(err)
	}

	base := filepath.Join(root, "apps", "docs", "production", "releases", "r1", "dist", "public")
	for name, body := range files {
		path := filepath.Join(base, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	return New(root, store, slog.New(slog.DiscardHandler))
}

// get asks the proxy for a path and returns the status and body.
func get(t *testing.T, p *Proxy, path string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "http://docs.bay.localhost"+path, nil)
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, req)
	res := rec.Result()
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return res.StatusCode, string(body)
}

func TestStaticSiteServesTheRootIndex(t *testing.T) {
	p := staticSite(t, map[string]string{"index.html": "home"})

	status, body := get(t, p, "/")

	if status != http.StatusOK || body != "home" {
		t.Fatalf("got %d %q, want 200 \"home\"", status, body)
	}
}

func TestStaticSiteResolvesAnExtensionlessPathToItsHtmlFile(t *testing.T) {
	// The whole reason a static app needs its own lookup. The build writes
	// `/changelog` as `changelog.html`, so an exact-path stat finds a directory
	// that is not there and, with no process to fall back to, every page but the
	// root would 404.
	p := staticSite(t, map[string]string{
		"index.html":     "home",
		"changelog.html": "changelog",
	})

	status, body := get(t, p, "/changelog")

	if status != http.StatusOK || body != "changelog" {
		t.Fatalf("got %d %q, want 200 \"changelog\"", status, body)
	}
}

func TestStaticSiteResolvesANestedExtensionlessPath(t *testing.T) {
	p := staticSite(t, map[string]string{
		"index.html":                           "home",
		"docs/guides-server-building-api.html": "guide",
	})

	status, body := get(t, p, "/docs/guides-server-building-api")

	if status != http.StatusOK || body != "guide" {
		t.Fatalf("got %d %q, want 200 \"guide\"", status, body)
	}
}

func TestStaticSiteResolvesADirectoryIndex(t *testing.T) {
	// Alepha's own build emits flat files, but other generators write
	// `about/index.html`. Serving it costs one extra stat on a path that has
	// already missed twice.
	p := staticSite(t, map[string]string{
		"index.html":       "home",
		"about/index.html": "about",
	})

	status, body := get(t, p, "/about")

	if status != http.StatusOK || body != "about" {
		t.Fatalf("got %d %q, want 200 \"about\"", status, body)
	}
}

func TestStaticSiteFallsBackToTheSpaShellForAnUnknownRoute(t *testing.T) {
	// A client-routed app resolves the path itself. `200.html` is the shell the
	// build writes for exactly this, and it must answer 200 — a SPA served at
	// 404 is one search engines drop and one `fetch` treats as an error.
	p := staticSite(t, map[string]string{
		"index.html": "home",
		"200.html":   "shell",
		"404.html":   "missing",
	})

	status, body := get(t, p, "/some/client/route")

	if status != http.StatusOK || body != "shell" {
		t.Fatalf("got %d %q, want 200 \"shell\"", status, body)
	}
}

func TestStaticSiteServesTheNotFoundPageWhenThereIsNoShell(t *testing.T) {
	// A prerendered site has no client router, so an unknown path is genuinely
	// missing and must say so with the status, not just the body.
	p := staticSite(t, map[string]string{
		"index.html": "home",
		"404.html":   "missing",
	})

	status, body := get(t, p, "/nope")

	if status != http.StatusNotFound || body != "missing" {
		t.Fatalf("got %d %q, want 404 \"missing\"", status, body)
	}
}

func TestStaticSiteNeverFallsBackForAMissingAsset(t *testing.T) {
	// Handing `200.html` to a request for a .js file turns a missing chunk into
	// a syntax error in the console, which is a much longer walk back to the
	// real cause.
	p := staticSite(t, map[string]string{
		"index.html": "home",
		"200.html":   "shell",
		"404.html":   "missing",
	})

	status, body := get(t, p, "/entry.DyJ8G-7l.js")

	if status != http.StatusNotFound {
		t.Fatalf("got %d %q, want 404", status, body)
	}
	if body == "shell" {
		t.Fatal("an asset request must never be answered with the SPA shell")
	}
}

func TestStaticSiteWithNoFallbackFilesStill404s(t *testing.T) {
	p := staticSite(t, map[string]string{"index.html": "home"})

	status, _ := get(t, p, "/nope")

	if status != http.StatusNotFound {
		t.Fatalf("got %d, want 404", status)
	}
}
