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
