package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/state"
)

// runtimesFixture is a server with one instance whose current release carries
// the given manifest runtimes.
func runtimesFixture(t *testing.T, runtimesJSON string) *server {
	t.Helper()
	root := t.TempDir()
	store, err := state.Open(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Upsert(state.App{Name: "api", Env: "production", Port: 4100, Release: "r1"}); err != nil {
		t.Fatal(err)
	}
	current := filepath.Join(root, "apps", naming.Instance("api", "production"), "current")
	if err := os.MkdirAll(current, 0o755); err != nil {
		t.Fatal(err)
	}
	manifest := `{"project": "api", "runtimes": ` + runtimesJSON + `}`
	if err := os.WriteFile(filepath.Join(current, "manifest.json"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	return &server{root: root, store: store, runner: newFakeRunner()}
}

func TestRuntimes(t *testing.T) {
	t.Run("an instance runs the image of its manifest's runtime and major", func(t *testing.T) {
		s := runtimesFixture(t, `[{"runtime": "node", "entry": "index.node.js", "runtimeVersion": "24"}]`)
		report := s.runtimesReport()
		if len(report.Instances) != 1 || !strings.HasPrefix(report.Instances[0].Image, "node:24-slim@sha256:") {
			t.Fatalf("instances = %+v", report.Instances)
		}
		if len(report.Images) == 0 || report.Images[0].Refreshed {
			t.Fatalf("images = %+v", report.Images)
		}
	})

	t.Run("an unsupported major is reported on the instance, not hidden", func(t *testing.T) {
		s := runtimesFixture(t, `[{"runtime": "node", "entry": "index.node.js", "runtimeVersion": "18"}]`)
		inst := s.runtimesReport().Instances[0]
		if inst.Image != "" || !strings.Contains(inst.Error, "supported majors") {
			t.Fatalf("instance = %+v", inst)
		}
	})

	t.Run("a refreshed digest is what the instance runs", func(t *testing.T) {
		s := runtimesFixture(t, `[{"runtime": "node", "entry": "index.node.js", "runtimeVersion": "26"}]`)
		if err := s.store.SetRuntimeLock("node:26-slim", "node:26-slim@sha256:newer"); err != nil {
			t.Fatal(err)
		}
		report := s.runtimesReport()
		if report.Instances[0].Image != "node:26-slim@sha256:newer" {
			t.Fatalf("instance = %+v", report.Instances[0])
		}
		for _, img := range report.Images {
			if img.Tag == "node:26-slim" && !img.Refreshed {
				t.Fatalf("image row = %+v", img)
			}
		}
	})

	t.Run("an instance's own image is set, shown as an override, and cleared", func(t *testing.T) {
		s := runtimesFixture(t, `[{"runtime": "node", "entry": "index.node.js", "runtimeVersion": "26"}]`)
		mux := s.controlMux()
		put := func(body string) int {
			req := httptest.NewRequest(http.MethodPut, "/apps/api/production/runtime-image", strings.NewReader(body))
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			return rec.Code
		}
		if code := put(`{"image": "node:26-alpine"}`); code != 200 {
			t.Fatalf("set: %d", code)
		}
		inst := s.runtimesReport().Instances[0]
		if inst.Image != "node:26-alpine" || !inst.Override {
			t.Fatalf("instance = %+v", inst)
		}
		if code := put(`{"image": ""}`); code != 200 {
			t.Fatalf("clear: %d", code)
		}
		if inst := s.runtimesReport().Instances[0]; inst.Override {
			t.Fatalf("still overridden: %+v", inst)
		}
		if code := put(`{"image": "node 26"}`); code != 400 {
			t.Fatalf("whitespace accepted: %d", code)
		}
	})

	t.Run("the report travels as JSON over the control API", func(t *testing.T) {
		s := runtimesFixture(t, `[{"runtime": "bun", "entry": "index.bun.js", "runtimeVersion": "1"}]`)
		rec := httptest.NewRecorder()
		s.controlMux().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/runtimes", nil))
		var report runtimesReport
		if err := json.Unmarshal(rec.Body.Bytes(), &report); err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(report.Instances[0].Image, "oven/bun:1-slim@sha256:") {
			t.Fatalf("report = %+v", report)
		}
	})

	t.Run("digests print short", func(t *testing.T) {
		if got := digestOf("node:26-slim@sha256:0123456789abcdef"); got != "0123456789ab" {
			t.Fatalf("digest = %q", got)
		}
	})
}
