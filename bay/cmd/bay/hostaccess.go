package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/state"
)

// defaultPids is every app's ceiling on processes and threads unless
// `bay harden --pids` says otherwise: plenty for Node, low enough that a fork
// bomb stays inside its container.
const defaultPids = 256

func pidsOf(app state.App) int {
	if app.PidsLimit > 0 {
		return app.PidsLimit
	}
	return defaultPids
}

/*
parsePids reads a `bay harden --pids` value: a count, or "default".

Bounded like parseMemory: under 64 a Node process cannot start its thread
pool, and past 32768 the limit protects nothing.
*/
func parsePids(raw string) (int, error) {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "default" || raw == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 64 || n > 32768 {
		return 0, fmt.Errorf("pids %q: give a count between 64 and 32768, or default", raw)
	}
	return n, nil
}

// hostMountDenied are host trees no app is ever handed, nor any path inside
// them or any folder above them: the system itself, the container engine, and
// /run (control sockets, Bay's own among them). Mounting /var/lib would hand
// /var/lib/docker over just as surely as mounting it by name.
var hostMountDenied = []string{
	"/bin", "/boot", "/dev", "/etc", "/lib", "/lib32", "/lib64", "/proc", "/root",
	"/run", "/sbin", "/sys", "/usr", "/var/lib/containerd", "/var/lib/docker", "/var/run",
}

// within reports whether path is dir or inside it.
func within(path, dir string) bool {
	return path == dir || strings.HasPrefix(path, strings.TrimSuffix(dir, "/")+"/")
}

// resolved is p and, when it differs, where its symlinks lead: a guarded
// path is compared in both forms, so a Bay root or a Docker root behind a
// symlink is still found under the real path an operator gives.
func resolved(p string) []string {
	p = filepath.Clean(p)
	if real, err := filepath.EvalSymlinks(p); err == nil && real != p {
		return []string{p, real}
	}
	return []string{p}
}

/*
checkHostMount decides whether a host path may be handed to an app.

The path must be absolute, clean, existing and no symlink (so what is checked
is what gets mounted). It may not be inside, or contain, a denied tree, Bay's
root or its control socket: mounting /opt would hand every other app's data
over. Inside Bay's root, only a path inside the app's own instance directory
is accepted. Guarded paths are checked as given and as their symlinks
resolve.
*/
func (s *server) checkHostMount(app state.App, path string) error {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || path == "/" {
		return fmt.Errorf("mount %q: give an absolute, clean path other than /", path)
	}
	if _, err := os.Lstat(path); err != nil {
		return fmt.Errorf("mount %q: %w", path, err)
	}
	if real, err := filepath.EvalSymlinks(path); err != nil || real != path {
		return fmt.Errorf("mount %q: a symlink or a path through one; give the real path", path)
	}
	for _, entry := range hostMountDenied {
		for _, denied := range resolved(entry) {
			if within(path, denied) {
				return fmt.Errorf("mount %q: nothing under %s is handed to an app", path, denied)
			}
			if within(denied, path) {
				return fmt.Errorf("mount %q: it contains %s", path, denied)
			}
		}
	}
	guards := []string{}
	if s.controlSocket != "" {
		guards = append(guards, resolved(s.controlSocket)...)
	}
	roots := resolved(s.root)
	for _, guarded := range append(guards, roots...) {
		if guarded != "." && within(guarded, path) {
			return fmt.Errorf("mount %q: it contains %s", path, guarded)
		}
	}
	for _, root := range roots {
		if within(path, root) {
			instance := filepath.Join(root, "apps", naming.Instance(app.Name, app.Env))
			if path == instance || !within(path, instance) {
				return fmt.Errorf("mount %q: inside Bay's root, only a path inside %s's own directory", path, app.Key())
			}
		}
	}
	return nil
}

// parseHostMounts reads `bay harden --mount` values: "/path" (read-only) or
// "/path:rw", comma-separated; "none" clears the list.
func parseHostMounts(raw string) ([]state.HostMount, error) {
	raw = strings.TrimSpace(raw)
	if raw == "none" || raw == "" {
		return nil, nil
	}
	var out []state.HostMount
	for _, item := range strings.Split(raw, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		m := state.HostMount{Path: item, ReadOnly: true}
		if p, mode, ok := strings.Cut(item, ":"); ok {
			switch mode {
			case "ro":
			case "rw":
				m.ReadOnly = false
			default:
				return nil, fmt.Errorf("mount %q: the mode is ro or rw", item)
			}
			m.Path = p
		}
		out = append(out, m)
	}
	return out, nil
}

// restartIfRunning restarts an instance (blue/green) so a recorded setting is
// the one in force, and says whether it did.
func (s *server) restartIfRunning(key string) (bool, error) {
	if !s.runner.Running(key) {
		return false, nil
	}
	app, _ := s.store.Get(key)
	if err := s.restart(app); err != nil {
		return false, errors.New("recorded, but the app did not come back up with it: " + err.Error())
	}
	return true, nil
}

// handlePids sets an instance's process/thread ceiling ("1024", "default").
func (s *server) handlePids(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("name") + "/" + r.PathValue("env")
	if _, ok := s.store.Get(key); !ok {
		writeError(w, http.StatusNotFound, "unknown instance "+key)
		return
	}
	var body struct {
		Pids string `json:"pids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, `body must be {"pids": "1024"}`)
		return
	}
	n, err := parsePids(body.Pids)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.SetPidsLimit(key, n); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	restarted, err := s.restartIfRunning(key)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	app, _ := s.store.Get(key)
	writeJSON(w, http.StatusOK, map[string]any{"instance": key, "pidsLimit": pidsOf(app), "restarted": restarted})
}

/*
handleHostMounts replaces the host paths an archive app sees. Each is checked
by checkHostMount before anything is recorded; an image app is refused, since
it is defined as seeing no host path.
*/
func (s *server) handleHostMounts(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("name") + "/" + r.PathValue("env")
	app, ok := s.store.Get(key)
	if !ok {
		writeError(w, http.StatusNotFound, "unknown instance "+key)
		return
	}
	if app.Image != "" {
		writeError(w, http.StatusBadRequest, key+" is an image app: it sees no host path")
		return
	}
	var body struct {
		Mounts []state.HostMount `json:"mounts"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, `body must be {"mounts": [{"path": "/x", "readOnly": true}]}`)
		return
	}
	seen := map[string]bool{}
	for _, m := range body.Mounts {
		if seen[m.Path] {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("mount %q is listed twice", m.Path))
			return
		}
		seen[m.Path] = true
		if err := s.checkHostMount(app, m.Path); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	if len(body.Mounts) == 0 {
		body.Mounts = nil
	}
	if err := s.store.SetHostMounts(key, body.Mounts); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	restarted, err := s.restartIfRunning(key)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"instance": key, "mounts": body.Mounts, "restarted": restarted})
}
