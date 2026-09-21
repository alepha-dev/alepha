package deploy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alepha/bay/internal/naming"
)

// staticArtifactWithHeaders is a static site whose dist/public carries a
// `_headers`.
func staticArtifactWithHeaders(t *testing.T, name, headersFile string) string {
	t.Helper()
	return buildArchive(t,
		entry{name: "manifest.json", body: `{"project": "` + name + `", "runtimes": [{"runtime": "static"}]}`},
		entry{name: "public/index.html", body: "<html></html>"},
		entry{name: "public/_headers", body: headersFile},
	)
}

func TestDeployRefusesAHeadersFileThatDoesNotParse(t *testing.T) {
	// The running release has to keep serving: refused before placement, so
	// nothing under releases/ and nothing in the store moves.
	root := t.TempDir()
	store := newStore(t, root)
	first := deployStatic(t, root, store, "docs")

	_, err := Run(Options{
		Root:       root,
		Artifact:   staticArtifactWithHeaders(t, "docs", "/a\n  X-A: 1\n/movies/:title\n  X-B: 2\n"),
		Name:       "docs",
		Env:        "production",
		BaseDomain: "bay.test",
	}, store)

	if err == nil {
		t.Fatal("a _headers with a placeholder was deployed")
	}
	if !strings.Contains(err.Error(), "public/_headers:3: ") {
		t.Fatalf("the refusal does not name the line: %v", err)
	}
	app, _ := store.Get("docs/production")
	if app.Release != first.Release {
		t.Fatalf("current release moved to %s, want %s", app.Release, first.Release)
	}
	releases, err := os.ReadDir(filepath.Join(root, "apps", naming.Instance("docs", "production"), "releases"))
	if err != nil {
		t.Fatal(err)
	}
	if len(releases) != 1 {
		t.Fatalf("%d releases on disk, want only the one still serving", len(releases))
	}
}

func TestDeployAcceptsAHeadersFileThatParses(t *testing.T) {
	root := t.TempDir()
	store := newStore(t, root)

	res, err := Run(Options{
		Root:       root,
		Artifact:   staticArtifactWithHeaders(t, "docs", "/*\n  X-Frame-Options: DENY\n"),
		Name:       "docs",
		Env:        "production",
		BaseDomain: "bay.test",
	}, store)

	if err != nil {
		t.Fatal(err)
	}
	if res.Release == "" {
		t.Fatal("no release was placed")
	}
}
