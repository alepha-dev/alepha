package state

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPersistsAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Upsert(App{Name: "lore", Env: "production", Domain: "lore.test", Port: 4001}); err != nil {
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
		if err := s.Upsert(App{Name: "lore", Env: "production", Domain: domain}); err != nil {
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

func TestTokenIsGeneratedOnceAndReused(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, _ := Open(path)

	calls := 0
	gen := func() string { calls++; return "bay_generated" }

	first, err := s.Token(gen)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Token(gen)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatal("token must be stable")
	}
	if calls != 1 {
		t.Fatalf("token should be generated once, generated %d times", calls)
	}

	// And it must survive a restart, otherwise every bay restart locks out the
	// CLI and bay-ui.
	reopened, _ := Open(path)
	again, _ := reopened.Token(gen)
	if again != first {
		t.Fatal("token must persist across restarts")
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
