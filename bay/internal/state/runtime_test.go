package state

import (
	"path/filepath"
	"testing"
)

func TestRuntimeImages(t *testing.T) {
	t.Run("a runtime lock persists across a reopen and is returned as a copy", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "state.json")
		s, err := Open(path)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.SetRuntimeLock("node:26-slim", "node:26-slim@sha256:aaa"); err != nil {
			t.Fatal(err)
		}
		locks := s.RuntimeLocks()
		locks["node:26-slim"] = "tampered"

		reopened, err := Open(path)
		if err != nil {
			t.Fatal(err)
		}
		if got := reopened.RuntimeLocks()["node:26-slim"]; got != "node:26-slim@sha256:aaa" {
			t.Fatalf("lock = %q", got)
		}
	})

	t.Run("an instance's own runtime image persists and can be cleared", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "state.json")
		s, _ := Open(path)
		if err := s.Upsert(App{Name: "api", Env: "production", Port: 4100}); err != nil {
			t.Fatal(err)
		}
		if err := s.SetRuntimeImage("api/production", "node:26-alpine"); err != nil {
			t.Fatal(err)
		}
		reopened, _ := Open(path)
		if app, _ := reopened.Get("api/production"); app.RuntimeImage != "node:26-alpine" {
			t.Fatalf("image = %q", app.RuntimeImage)
		}
		if err := reopened.SetRuntimeImage("api/production", ""); err != nil {
			t.Fatal(err)
		}
		if app, _ := reopened.Get("api/production"); app.RuntimeImage != "" {
			t.Fatalf("image not cleared: %q", app.RuntimeImage)
		}
	})
}
