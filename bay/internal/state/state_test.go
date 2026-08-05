package state

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPersistsAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Upsert(App{Name: "lore", Env: "production", Domains: []string{"lore.test"}, Port: 4001}); err != nil {
		t.Fatal(err)
	}

	// A bay restart must find its world exactly where it left it — this is what
	// makes the routing table survive a crash.
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	app, ok := reopened.ByDomain("lore.test")
	if !ok {
		t.Fatal("app not found after reopen")
	}
	if app.Port != 4001 {
		t.Fatalf("port not preserved, got %d", app.Port)
	}
}

func TestUpsertReplacesRatherThanDuplicates(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, domain := range []string{"a.test", "b.test"} {
		if err := s.Upsert(App{Name: "lore", Env: "production", Domains: []string{domain}}); err != nil {
			t.Fatal(err)
		}
	}
	if got := len(s.Apps()); got != 1 {
		t.Fatalf("expected the instance to be replaced, got %d entries", got)
	}
	if _, ok := s.ByDomain("b.test"); !ok {
		t.Fatal("latest domain should win")
	}
}

func TestWritesAtomicallyAndKeepsBackup(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "state.json")
	s, _ := Open(path)
	if err := s.Upsert(App{Name: "a", Env: "production"}); err != nil {
		t.Fatal(err)
	}
	if err := s.Upsert(App{Name: "b", Env: "production"}); err != nil {
		t.Fatal(err)
	}

	// A torn state file is a total outage: bay would come back with no idea
	// where anything lives. Hence temp+rename, plus a .bak to fall back on.
	if _, err := os.Stat(path + ".bak"); err != nil {
		t.Fatalf("expected a .bak alongside the state file: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("state file should be 0600, got %o", perm)
	}

	// No stray temp files left behind.
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".tmp" {
			t.Fatalf("temp file left behind: %s", e.Name())
		}
	}
}

func TestUsedPortsReportsClaims(t *testing.T) {
	s, _ := Open(filepath.Join(t.TempDir(), "state.json"))
	_ = s.Upsert(App{Name: "a", Env: "production", Port: 5001})
	_ = s.Upsert(App{Name: "b", Env: "production", Port: 5002})
	used := s.UsedPorts()
	if !used[5001] || !used[5002] {
		t.Fatalf("claimed ports not reported: %v", used)
	}
}

func TestUpsertPreservesRuntimeOwnedFields(t *testing.T) {
	// A deploy builds a fresh App from the artifact and knows nothing about
	// backup bookkeeping or sleep state. Replacing wholesale reset them on every
	// redeploy — which for `LastBackupAt` means the staleness warning goes quiet
	// exactly when someone touches the app.
	s, err := Open(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Upsert(App{Name: "lore", Env: "production", Port: 5000}); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordBackupSuccess("lore/production", "apps/lore/production/db/x.gz", time.Unix(1700000000, 0)); err != nil {
		t.Fatal(err)
	}
	// Traffic history is the other. Resetting it on redeploy would mean the
	// staleness badge reads "no traffic ever" for the apps someone is actively
	// working on — the exact opposite of what it is for.
	if err := s.RecordLastRequest("lore/production", time.Unix(1700000000, 0)); err != nil {
		t.Fatal(err)
	}

	// A redeploy: same key, fresh record, new release.
	if err := s.Upsert(App{
		Name: "lore", Env: "production", Port: 5000,
		Release: "2026-07-30-120000", Crons: 3,
	}); err != nil {
		t.Fatal(err)
	}

	got, ok := s.Get("lore/production")
	if !ok {
		t.Fatal("app vanished")
	}
	if got.Release != "2026-07-30-120000" {
		t.Fatalf("deploy-owned field should be taken from the argument, got %q", got.Release)
	}
	// The other half of the same rule, and the one that would rot quietly:
	// `Crons` is derived from the artifact's manifest, so it must follow the
	// release. Carrying it forward would leave an app that dropped its last
	// cron looking, forever, like it still had one — and therefore never
	// deletable on the strength of the badge.
	if got.Crons != 3 {
		t.Fatalf("Crons is derived from the manifest and must follow the release, got %d", got.Crons)
	}
	if got.LastBackupAt == "" {
		t.Fatal("LastBackupAt must survive a redeploy")
	}
	if got.LastBackupKey == "" {
		t.Fatal("LastBackupKey must survive a redeploy")
	}
	if got.LastRequestAt == "" {
		t.Fatal("LastRequestAt must survive a redeploy")
	}
}

func TestRecordLastRequestOnlyEverMovesForward(t *testing.T) {
	// The proxy drains a batch of timestamps on a ticker, and a batch can be
	// applied out of order after a restart or a slow flush. An older stamp
	// overwriting a newer one would make an app that IS being used read as
	// abandoned — a badge that says "no traffic for 40 days" about something
	// someone loaded a minute ago is worse than no badge.
	s, err := Open(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Upsert(App{Name: "lore", Env: "production", Port: 5000}); err != nil {
		t.Fatal(err)
	}

	recent := time.Unix(1700000000, 0)
	older := recent.Add(-2 * time.Hour)
	if err := s.RecordLastRequest("lore/production", recent); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordLastRequest("lore/production", older); err != nil {
		t.Fatal(err)
	}

	got, _ := s.Get("lore/production")
	if got.LastRequestAt != recent.UTC().Format(time.RFC3339) {
		t.Fatalf("a late stamp must not rewind the record, got %q", got.LastRequestAt)
	}
}

func TestBackupFailureKeepsTheLastGoodTimestamp(t *testing.T) {
	// `LastBackupAt` means "last time we had a usable backup". Advancing it on a
	// failure would make a run of failures look healthy.
	s, err := Open(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Upsert(App{Name: "a", Env: "production"}); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordBackupSuccess("a/production", "k", time.Unix(1700000000, 0)); err != nil {
		t.Fatal(err)
	}
	good, _ := s.Get("a/production")

	if err := s.RecordBackupFailure("a/production", "bucket unreachable", time.Unix(1700086400, 0)); err != nil {
		t.Fatal(err)
	}
	after, _ := s.Get("a/production")

	if after.LastBackupAt != good.LastBackupAt {
		t.Fatalf("a failure must not advance LastBackupAt: %q → %q", good.LastBackupAt, after.LastBackupAt)
	}
	if after.LastBackupError == "" {
		t.Fatal("the reason must be recorded, or a failing backup is indistinguishable from a stopped scheduler")
	}

	// And a later success clears it, so a stale reason never outlives the failure.
	if err := s.RecordBackupSuccess("a/production", "k2", time.Unix(1700172800, 0)); err != nil {
		t.Fatal(err)
	}
	healed, _ := s.Get("a/production")
	if healed.LastBackupError != "" {
		t.Fatalf("success must clear the error, got %q", healed.LastBackupError)
	}
}

func TestMutateRejectsUnknownApp(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.RecordBackupSuccess("ghost/production", "k", time.Unix(0, 0)); err == nil {
		t.Fatal("recording against an unknown app must fail loudly, not silently no-op")
	}
}
