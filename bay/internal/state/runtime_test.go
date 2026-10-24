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

func TestEnsureUID(t *testing.T) {
	t.Run("each instance gets its own uid, kept across a redeploy", func(t *testing.T) {
		s, _ := Open(filepath.Join(t.TempDir(), "state.json"))
		_ = s.Upsert(App{Name: "a", Env: "production", Port: 4100})
		_ = s.Upsert(App{Name: "b", Env: "production", Port: 4101})
		ua, err := s.EnsureUID("a/production")
		if err != nil {
			t.Fatal(err)
		}
		ub, _ := s.EnsureUID("b/production")
		if ua < 20000 || ub == ua {
			t.Fatalf("uids = %d, %d", ua, ub)
		}
		_ = s.Upsert(App{Name: "a", Env: "production", Port: 4100, Release: "r2"})
		if again, _ := s.EnsureUID("a/production"); again != ua {
			t.Fatalf("uid changed across a redeploy: %d -> %d", ua, again)
		}
	})
}

func TestStacks(t *testing.T) {
	t.Run("an environment is created on first mutation, persisted, and copied out", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "state.json")
		s, _ := Open(path)
		err := s.MutateStackEnv("umami", "production", func(e *StackEnv) error {
			e.Revision = 1
			e.Revisions = append(e.Revisions, StackRevision{Number: 1, Digests: map[string]string{"db": "postgres@sha256:a"}})
			e.Routes = append(e.Routes, StackRoute{Service: "umami", Domain: "analytics.bob.dev"})
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		reopened, _ := Open(path)
		env, ok := reopened.StackEnv("umami", "production")
		if !ok || env.Revision != 1 || len(env.Routes) != 1 || env.Revisions[0].Digests["db"] == "" {
			t.Fatalf("env = %+v", env)
		}
		env.Routes[0].Domain = "tampered"
		again, _ := reopened.StackEnv("umami", "production")
		if again.Routes[0].Domain != "analytics.bob.dev" {
			t.Fatal("StackEnv returned shared state")
		}
	})

	t.Run("removing an environment removes its members, and the stack when empty", func(t *testing.T) {
		s, _ := Open(filepath.Join(t.TempDir(), "state.json"))
		_ = s.MutateStackEnv("umami", "production", func(*StackEnv) error { return nil })
		_ = s.MutateStackEnv("umami", "staging", func(*StackEnv) error { return nil })
		_ = s.Upsert(App{Name: MemberName("umami", "umami"), Env: "production", Port: 4100, Stack: "umami", Service: "umami", ServiceKind: "service"})
		_ = s.Upsert(App{Name: MemberName("umami", "umami"), Env: "staging", Port: 4101, Stack: "umami", Service: "umami", ServiceKind: "service"})
		if err := s.RemoveStackEnv("umami", "production"); err != nil {
			t.Fatal(err)
		}
		if len(s.StackMembers("umami", "production")) != 0 || len(s.StackMembers("umami", "staging")) != 1 {
			t.Fatal("members not removed with their environment")
		}
		_ = s.RemoveStackEnv("umami", "staging")
		if len(s.Stacks()) != 0 {
			t.Fatalf("stacks = %+v", s.Stacks())
		}
	})

	t.Run("a member redeployed through the ordinary path stays a member", func(t *testing.T) {
		s, _ := Open(filepath.Join(t.TempDir(), "state.json"))
		_ = s.Upsert(App{Name: "mcs.api", Env: "staging", Port: 4100, Stack: "mcs", Service: "api", ServiceKind: "app"})
		_ = s.Upsert(App{Name: "mcs.api", Env: "staging", Port: 4100, Release: "r2"})
		if app, _ := s.Get("mcs.api/staging"); app.Stack != "mcs" || app.Service != "api" || app.ServiceKind != "app" {
			t.Fatalf("app = %+v", app)
		}
	})
}
