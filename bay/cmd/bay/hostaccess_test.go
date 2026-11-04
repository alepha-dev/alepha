package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/runner"
)

func TestPidsOverride(t *testing.T) {
	t.Run("counts parse bounded, with default", func(t *testing.T) {
		cases := map[string]int{"1024": 1024, "64": 64, "default": 0, "": 0}
		for raw, want := range cases {
			if got, err := parsePids(raw); err != nil || got != want {
				t.Errorf("%q: %d, %v", raw, got, err)
			}
		}
		for _, bad := range []string{"10", "40000", "-5", "lots", "1k"} {
			if _, err := parsePids(bad); err == nil {
				t.Errorf("%q accepted", bad)
			}
		}
	})

	t.Run("an override is recorded, applied to the container, and cleared", func(t *testing.T) {
		s := runtimesFixture(t, `[{"runtime": "node", "entry": "index.node.js", "runtimeVersion": "26"}]`)
		s.runner = &imageFakeRunner{fakeRunner: newFakeRunner()}
		put := func(body string) int {
			rec := httptest.NewRecorder()
			s.controlMux().ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/apps/api/production/pids", strings.NewReader(body)))
			return rec.Code
		}
		pids := func() int64 {
			app, _ := s.store.Get("api/production")
			spec, _, err := s.specFor(app)
			if err != nil {
				t.Fatal(err)
			}
			return spec.Sandbox.(runner.Container).PidsLimit
		}
		if pids() != defaultPids {
			t.Fatalf("default = %d", pids())
		}
		if code := put(`{"pids": "1024"}`); code != 200 || pids() != 1024 {
			t.Fatalf("set: %d, pids %d", code, pids())
		}
		if code := put(`{"pids": "99999"}`); code != 400 {
			t.Fatalf("out-of-range accepted: %d", code)
		}
		if code := put(`{"pids": "default"}`); code != 200 || pids() != defaultPids {
			t.Fatalf("clear: %d, pids %d", code, pids())
		}
	})
}

func TestHostMounts(t *testing.T) {
	t.Run("values parse as read-only unless :rw, none clears", func(t *testing.T) {
		got, err := parseHostMounts("/tmp/.X11-unix, /srv/x:rw,/srv/y:ro")
		if err != nil || len(got) != 3 || !got[0].ReadOnly || got[1].ReadOnly || got[1].Path != "/srv/x" || !got[2].ReadOnly {
			t.Fatalf("%+v %v", got, err)
		}
		if got, err := parseHostMounts("none"); err != nil || got != nil {
			t.Fatalf("none: %+v %v", got, err)
		}
		if _, err := parseHostMounts("/srv/x:rwx"); err == nil {
			t.Fatal("bad mode accepted")
		}
	})

	s := runtimesFixture(t, `[{"runtime": "node", "entry": "index.node.js", "runtimeVersion": "26"}]`)
	s.runner = &imageFakeRunner{fakeRunner: newFakeRunner()}
	s.root = realDir(t, s.root)
	s.controlSocket = filepath.Join(realDir(t, t.TempDir()), "control.sock")
	instance := filepath.Join(s.root, "apps", "api-production")
	own := filepath.Join(instance, "browsers")
	if err := os.MkdirAll(own, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, dir := range ownMounted {
		if err := os.MkdirAll(filepath.Join(instance, dir), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	other := filepath.Join(s.root, "apps", "other-production", "data")
	if err := os.MkdirAll(other, 0o755); err != nil {
		t.Fatal(err)
	}
	outside := realDir(t, t.TempDir())
	link := filepath.Join(realDir(t, t.TempDir()), "link")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	put := func(body string) (int, string) {
		rec := httptest.NewRecorder()
		s.controlMux().ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/apps/api/production/mounts", strings.NewReader(body)))
		return rec.Code, rec.Body.String()
	}
	mounts := func() []runner.Mount {
		app, _ := s.store.Get("api/production")
		spec, _, err := s.specFor(app)
		if err != nil {
			t.Fatal(err)
		}
		return spec.Sandbox.(runner.Container).Mounts
	}

	t.Run("refuses paths that would reach past the app", func(t *testing.T) {
		// Each with the reason it must be refused for, so none passes for
		// another (a temp folder behind a symlink refuses everything).
		for bad, why := range map[string]string{
			"/":                                "other than /",
			"relative":                         "absolute",
			outside + "/../x":                  "clean",
			"/app":                             "the container already has",
			"/tmp":                             "the container already has",
			s.root:                             "it contains " + s.root,
			filepath.Dir(s.root):               "it contains ",
			instance:                           "own directory",
			filepath.Join(instance, "data"):    "already mounted",
			filepath.Join(instance, "scratch"): "already mounted",
			other:                              "own directory",
			link:                               "symlink",
			filepath.Dir(s.controlSocket):      "it contains " + s.controlSocket,
			filepath.Join(outside, "missing"):  "no such file",
		} {
			body := `{"mounts": [{"path": "` + bad + `", "readOnly": true}]}`
			code, msg := put(body)
			if code != 400 {
				t.Errorf("%q accepted: %d %s", bad, code, msg)
			} else if !strings.Contains(msg, why) {
				t.Errorf("%q refused for another reason than %q: %s", bad, why, msg)
			}
		}
		// The host's own trees: their reasons hold on Linux only, where /etc
		// and /var are no symlinks and /run exists.
		for bad, why := range map[string]string{
			"/etc":                 "nothing under /etc",
			"/run":                 "nothing under /run",
			"/var/run/docker.sock": "",
			"/proc/self":           "",
			"/var":                 "it contains /var/",
			"/var/lib":             "it contains /var/lib/",
			"/home":                "nothing under /home",
			"/var/spool":           "nothing under /var/spool",
		} {
			if runtime.GOOS != "linux" {
				why = ""
			}
			code, msg := put(`{"mounts": [{"path": "` + bad + `", "readOnly": true}]}`)
			if code != 400 {
				t.Errorf("%q accepted: %d %s", bad, code, msg)
			} else if !strings.Contains(msg, why) {
				t.Errorf("%q refused for another reason than %q: %s", bad, why, msg)
			}
		}
		if code, _ := put(`{"mounts": [{"path": "` + outside + `"}, {"path": "` + outside + `"}]}`); code != 400 {
			t.Error("duplicate accepted")
		}
	})

	t.Run("refuses a path others could swap for a symlink after the check", func(t *testing.T) {
		// Docker binds the path again on every restart without asking Bay: a
		// folder others may write to lets them swap it for a link to /etc.
		shared := filepath.Join(realDir(t, t.TempDir()), "shared")
		inside := filepath.Join(shared, "media")
		if err := os.MkdirAll(inside, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(shared, 0o777); err != nil {
			t.Fatal(err)
		}
		if code, msg := put(`{"mounts": [{"path": "` + inside + `"}]}`); code != 400 || !strings.Contains(msg, "writable by others") {
			t.Fatalf("a path in a folder anyone may write accepted: %d %s", code, msg)
		}
		// Sticky, like /tmp: only an entry's owner may rename it, and this
		// one is Bay's.
		if err := os.Chmod(shared, 0o777|os.ModeSticky); err != nil {
			t.Fatal(err)
		}
		if code, msg := put(`{"mounts": [{"path": "` + inside + `"}]}`); code != 200 {
			t.Fatalf("a Bay-owned path in a sticky folder refused: %d %s", code, msg)
		}
		if code, _ := put(`{"mounts": []}`); code != 200 {
			t.Fatal(code)
		}
	})

	t.Run("a Bay root behind a symlink is guarded by its real path", func(t *testing.T) {
		real := s.root
		linked := filepath.Join(realDir(t, t.TempDir()), "bay")
		if err := os.Symlink(real, linked); err != nil {
			t.Fatal(err)
		}
		s.root = linked
		defer func() { s.root = real }()
		for _, bad := range []string{real, filepath.Dir(real), other} {
			body := `{"mounts": [{"path": "` + bad + `", "readOnly": true}]}`
			if code, msg := put(body); code != 400 {
				t.Errorf("%q accepted through the symlinked root: %d %s", bad, code, msg)
			}
		}
	})

	t.Run("accepts its own directory and outside paths, same path inside", func(t *testing.T) {
		code, msg := put(`{"mounts": [{"path": "` + own + `", "readOnly": true}, {"path": "` + outside + `", "readOnly": false}]}`)
		if code != 200 {
			t.Fatalf("%d %s", code, msg)
		}
		found := map[string]runner.Mount{}
		for _, m := range mounts() {
			found[m.Source] = m
		}
		if m, ok := found[own]; !ok || m.Target != own || !m.ReadOnly {
			t.Fatalf("own: %+v", found)
		}
		if m, ok := found[outside]; !ok || m.Target != outside || m.ReadOnly {
			t.Fatalf("outside: %+v", found)
		}
	})

	t.Run("is recorded, then cleared", func(t *testing.T) {
		app, _ := s.store.Get("api/production")
		if len(app.HostMounts) != 2 {
			t.Fatalf("recorded %+v", app.HostMounts)
		}
		if code, _ := put(`{"mounts": []}`); code != 200 {
			t.Fatal(code)
		}
		for _, m := range mounts() {
			if m.Source == own || m.Source == outside {
				t.Fatalf("still mounted: %+v", m)
			}
		}
	})
}

// realDir is dir with its symlinks resolved: a mount is refused when it goes
// through one, and macOS keeps its temp folders under /var, a symlink.
func realDir(t *testing.T, dir string) string {
	t.Helper()
	real, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatal(err)
	}
	return real
}
