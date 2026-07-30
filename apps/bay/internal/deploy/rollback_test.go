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

func TestMigrationsSinceNamesWhatRollbackCannotUndo(t *testing.T) {
	instance := t.TempDir()
	release(t, instance, "old", "sqlite/0001_init.sql")
	release(t, instance, "new", "sqlite/0001_init.sql", "sqlite/0002_add_column.sql")

	extra, err := MigrationsSince(instance, "new", "old")
	if err != nil {
		t.Fatal(err)
	}
	if len(extra) != 1 || extra[0] != "sqlite/0002_add_column.sql" {
		t.Fatalf("expected the one migration applied since `old`, got %v", extra)
	}
}

func TestMigrationsSinceIsEmptyWhenNothingMoved(t *testing.T) {
	// A code-only change. Rollback is unremarkable here, and must not demand a
	// confirmation for it — a prompt that fires when there is no risk teaches
	// people to answer yes without reading.
	instance := t.TempDir()
	release(t, instance, "old", "sqlite/0001_init.sql")
	release(t, instance, "new", "sqlite/0001_init.sql")

	extra, err := MigrationsSince(instance, "new", "old")
	if err != nil {
		t.Fatal(err)
	}
	if len(extra) != 0 {
		t.Fatalf("expected no difference, got %v", extra)
	}
}

func TestMigrationsSinceKeepsDialectsApart(t *testing.T) {
	// `sqlite/0001` and `postgres/0001` are different migrations that happen to
	// share a filename. Keying on the bare name would hide one behind the other.
	instance := t.TempDir()
	release(t, instance, "old", "sqlite/0001_init.sql")
	release(t, instance, "new", "sqlite/0001_init.sql", "postgres/0001_init.sql")

	extra, err := MigrationsSince(instance, "new", "old")
	if err != nil {
		t.Fatal(err)
	}
	if len(extra) != 1 || extra[0] != "postgres/0001_init.sql" {
		t.Fatalf("expected the postgres one only, got %v", extra)
	}
}

func TestMigrationsSinceIgnoresHistoryDirectories(t *testing.T) {
	// `meta/` (drizzle's snapshots) and `.archive/` hold history, not migrations
	// to apply. Counting them would report differences that mean nothing and
	// demand confirmations for nothing.
	instance := t.TempDir()
	release(t, instance, "old", "sqlite/0001_init.sql")
	release(t, instance, "new",
		"sqlite/0001_init.sql",
		"sqlite/meta/_journal.json",
		"sqlite/.archive/0000_old.sql",
	)

	extra, err := MigrationsSince(instance, "new", "old")
	if err != nil {
		t.Fatal(err)
	}
	if len(extra) != 0 {
		t.Fatalf("history is not a migration, got %v", extra)
	}
}

func TestMigrationsSinceToleratesAppsWithoutADatabase(t *testing.T) {
	instance := t.TempDir()
	release(t, instance, "old")
	release(t, instance, "new")

	if _, err := MigrationsSince(instance, "new", "old"); err != nil {
		t.Fatalf("an app with no migrations/ is not an error: %v", err)
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
