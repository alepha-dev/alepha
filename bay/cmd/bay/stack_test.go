package main

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/state"
)

func TestStackVarsAPI(t *testing.T) {
	f := newDeployFixture(t)
	mux := f.server.controlMux()
	do := func(method, path, body string) (int, map[string]any) {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
		var out map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}

	t.Run("set answers what changed and list answers names only", func(t *testing.T) {
		code, out := do(http.MethodPut, "/stacks/umami/production/vars", "APP_SECRET=s3cret\nDB_PASSWORD=p\n")
		if code != 200 || len(out["changed"].([]any)) != 2 {
			t.Fatalf("%d %v", code, out)
		}
		code, out = do(http.MethodGet, "/stacks/umami/production/vars", "")
		raw, _ := json.Marshal(out)
		if code != 200 || strings.Contains(string(raw), "s3cret") || !strings.Contains(string(raw), "APP_SECRET") {
			t.Fatalf("%d %s", code, raw)
		}
	})

	t.Run("unset removes", func(t *testing.T) {
		code, out := do(http.MethodDelete, "/stacks/umami/production/vars?key=DB_PASSWORD", "")
		if code != 200 || len(out["removed"].([]any)) != 1 {
			t.Fatalf("%d %v", code, out)
		}
	})

	t.Run("a malformed stack or environment name is refused", func(t *testing.T) {
		if code, _ := do(http.MethodPut, "/stacks/Umami_1/production/vars", "X=1"); code != 400 {
			t.Fatalf("code = %d", code)
		}
	})
}

func TestStackRoutesAPI(t *testing.T) {
	f := newDeployFixture(t)
	mux := f.server.controlMux()
	do := func(method, path, body string) (int, string) {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
		return rec.Code, rec.Body.String()
	}

	t.Run("a route is recorded before the first deploy and listed", func(t *testing.T) {
		code, body := do(http.MethodPut, "/stacks/umami/production/routes", `{"service": "umami", "domain": "Analytics.Bob.dev"}`)
		if code != 200 || !strings.Contains(body, "first `bay stack deploy`") {
			t.Fatalf("%d %s", code, body)
		}
		_, body = do(http.MethodGet, "/stacks/umami/production/routes", "")
		if !strings.Contains(body, `"analytics.bob.dev"`) {
			t.Fatalf("list = %s", body)
		}
	})

	t.Run("the same domain twice, a wildcard or a malformed one is refused", func(t *testing.T) {
		if code, _ := do(http.MethodPut, "/stacks/umami/production/routes", `{"service": "umami", "domain": "analytics.bob.dev"}`); code != 409 {
			t.Fatalf("duplicate: %d", code)
		}
		for _, bad := range []string{"*.bob.dev", "localhost", "bob dev.com"} {
			if code, _ := do(http.MethodPut, "/stacks/umami/production/routes", `{"service": "umami", "domain": "`+bad+`"}`); code != 400 {
				t.Errorf("%q: %d", bad, code)
			}
		}
	})

	t.Run("a domain another instance serves is refused", func(t *testing.T) {
		if code, body := do(http.MethodPut, "/stacks/umami/staging/routes", `{"service": "umami", "domain": "analytics.bob.dev"}`); code != 409 {
			t.Fatalf("%d %s", code, body)
		}
	})

	t.Run("removing a route that is not there is a 404", func(t *testing.T) {
		if code, _ := do(http.MethodDelete, "/stacks/umami/production/routes?domain=nope.bob.dev", ""); code != 404 {
			t.Fatalf("code = %d", code)
		}
		if code, _ := do(http.MethodDelete, "/stacks/umami/production/routes?domain=analytics.bob.dev", ""); code != 200 {
			t.Fatalf("code = %d", code)
		}
	})
}

func TestStackCLIHelpers(t *testing.T) {
	t.Run("a member deploy becomes the member app's deploy", func(t *testing.T) {
		args, ok := memberDeployArgs([]string{"mcs/staging/api", "-"})
		if !ok || strings.Join(args, " ") != "- --name mcs.api --env staging" {
			t.Fatalf("args = %v", args)
		}
		args, _ = memberDeployArgs([]string{"mcs/staging/api", "--image", "r@sha256:x", "--port", "3000"})
		if strings.Join(args, " ") != "--image r@sha256:x --port 3000 --name mcs.api --env staging" {
			t.Fatalf("args = %v", args)
		}
		if _, ok := memberDeployArgs([]string{"app.tar.zst", "--name", "x"}); ok {
			t.Fatal("an ordinary deploy was taken for a member deploy")
		}
	})

	t.Run("a bundle directory packs its files, without .git or node_modules", func(t *testing.T) {
		dir := t.TempDir()
		for path, body := range map[string]string{
			"compose.yml": "services: {}\n", "conf/mosquitto.conf": "x", ".git/HEAD": "ref", "node_modules/a/i.js": "x",
		} {
			_ = os.MkdirAll(filepath.Dir(filepath.Join(dir, path)), 0o755)
			_ = os.WriteFile(filepath.Join(dir, path), []byte(body), 0o644)
		}
		packed, err := packBundle(dir)
		if err != nil {
			t.Fatal(err)
		}
		defer os.Remove(packed)
		f, _ := os.Open(packed)
		defer f.Close()
		gz, _ := gzip.NewReader(f)
		tr := tar.NewReader(gz)
		var names []string
		for {
			h, err := tr.Next()
			if err != nil {
				break
			}
			names = append(names, h.Name)
		}
		sort.Strings(names)
		if strings.Join(names, ",") != "compose.yml,conf/mosquitto.conf" {
			t.Fatalf("packed = %v", names)
		}
		if _, err := packBundle(t.TempDir()); err == nil {
			t.Fatal("a directory with no compose file was packed")
		}
	})

	t.Run("list and show answer the recorded environments and members", func(t *testing.T) {
		f := newDeployFixture(t)
		_ = f.server.store.MutateStackEnv("umami", "production", func(e *state.StackEnv) error {
			e.Revision = 1
			e.Revisions = []state.StackRevision{{Number: 1}}
			return nil
		})
		_ = f.server.store.Upsert(state.App{Name: "umami.db", Env: "production", Stack: "umami", Service: "db", ServiceKind: "service"})
		mux := f.server.controlMux()
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/stacks", nil))
		if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"stack":"umami"`) {
			t.Fatalf("%d %s", rec.Code, rec.Body.String())
		}
		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/stacks/umami/production", nil))
		if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"service":"db"`) {
			t.Fatalf("%d %s", rec.Code, rec.Body.String())
		}
		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/stacks/nope/production", nil))
		if rec.Code != 404 {
			t.Fatalf("unknown: %d", rec.Code)
		}
	})
}
