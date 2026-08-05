package deploy

import (
	"os"
	"path/filepath"
	"testing"
)

// release lays out one release directory with the given migration files,
// spelled `dialect/name`.
func release(t *testing.T, instance, name string, migrations ...string) {
	t.Helper()
	dir := filepath.Join(instance, "releases", name)
	if err := os.MkdirAll(filepath.Join(dir, "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, m := range migrations {
		path := filepath.Join(dir, "migrations", m)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("select 1;"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestReleasesAreNewestFirst(t *testing.T) {
	instance := t.TempDir()
	release(t, instance, "2026-07-28-100000")
	release(t, instance, "2026-07-30-120000")
	release(t, instance, "2026-07-29-090000")

	got, err := Releases(instance)
	if err != nil {
		t.Fatal(err)
	}
	// The timestamp format sorts lexicographically in chronological order, so a
	// reverse string sort is the chronological one — no parsing to get wrong.
	want := []string{"2026-07-30-120000", "2026-07-29-090000", "2026-07-28-100000"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("expected %v, got %v", want, got)
		}
	}
}

func TestSwapReleaseIsAtomicAndChecksTheTarget(t *testing.T) {
	instance := t.TempDir()
	release(t, instance, "a")
	release(t, instance, "b")

	if err := SwapRelease(instance, "a"); err != nil {
		t.Fatal(err)
	}
	resolved, err := filepath.EvalSymlinks(filepath.Join(instance, "current"))
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(resolved) != "a" {
		t.Fatalf("current should point at a, got %s", resolved)
	}

	// Swapping over an existing symlink must work — that is the whole point.
	if err := SwapRelease(instance, "b"); err != nil {
		t.Fatal(err)
	}
	resolved, _ = filepath.EvalSymlinks(filepath.Join(instance, "current"))
	if filepath.Base(resolved) != "b" {
		t.Fatalf("current should point at b, got %s", resolved)
	}

	// A missing release must be refused before `current` is touched, or a typo
	// would leave the app pointing at nothing.
	if err := SwapRelease(instance, "ghost"); err == nil {
		t.Fatal("expected an unknown release to be refused")
	}
	resolved, _ = filepath.EvalSymlinks(filepath.Join(instance, "current"))
	if filepath.Base(resolved) != "b" {
		t.Fatalf("a failed swap must leave current alone, got %s", resolved)
	}
}

func TestSubdomainComposition(t *testing.T) {
	// Production reads well bare; anything else is suffixed, so staging never
	// collides with production on the same base domain.
	//
	// Composed from the EFFECTIVE name — the one that also keys the instance —
	// rather than from the manifest, so `--name` cannot produce an app registered
	// under one name and served under another.
	if got := subdomain("lore", "production"); got != "lore" {
		t.Fatalf("production should be bare, got %q", got)
	}
	if got := subdomain("lore", ""); got != "lore" {
		t.Fatalf("empty env should behave as production, got %q", got)
	}
	if got := subdomain("lore", "staging"); got != "lore-staging" {
		t.Fatalf("got %q", got)
	}
}
