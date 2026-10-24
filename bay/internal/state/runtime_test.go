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

func TestUpsertKeepsInstanceOwnedFields(t *testing.T) {
	t.Run("a redeploy keeps the live host port and the chosen runtime image", func(t *testing.T) {
		s, _ := Open(filepath.Join(t.TempDir(), "state.json"))
		if err := s.Upsert(App{Name: "api", Env: "production", Port: 4100, Release: "r1"}); err != nil {
			t.Fatal(err)
		}
		if err := s.SetHostPort("api/production", 4733); err != nil {
			t.Fatal(err)
		}
		if err := s.SetRuntimeImage("api/production", "node:26-alpine"); err != nil {
			t.Fatal(err)
		}
		if err := s.Upsert(App{Name: "api", Env: "production", Port: 4100, Release: "r2"}); err != nil {
			t.Fatal(err)
		}
		app, _ := s.Get("api/production")
		if app.Release != "r2" || app.UpstreamPort() != 4733 || app.RuntimeImage != "node:26-alpine" {
			t.Fatalf("app = %+v", app)
		}
	})

	t.Run("the live host port is claimed, so blue/green never hands it out twice", func(t *testing.T) {
		s, _ := Open(filepath.Join(t.TempDir(), "state.json"))
		_ = s.Upsert(App{Name: "api", Env: "production", Port: 4100})
		_ = s.SetHostPort("api/production", 4733)
		used := s.UsedPorts()
		if !used[4100] || !used[4733] {
			t.Fatalf("used = %v", used)
		}
	})
}
