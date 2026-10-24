package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
