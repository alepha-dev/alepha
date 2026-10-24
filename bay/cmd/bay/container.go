package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/alepha-dev/bay/internal/deploy"
	"github.com/alepha-dev/bay/internal/manifest"
	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/runner"
	"github.com/alepha-dev/bay/internal/stack"
	"github.com/alepha-dev/bay/internal/state"
)

/*
containerRunner is a supervisor that runs apps in images.

The Docker runner is one; the child runner and the tests' fake are not, and
keep receiving the host-binary spec until the systemd and child paths are
deleted (epic E73, Bay quest 2597).
*/
type containerRunner interface {
	runner.Runner
	EnsureImage(ref string) error
	StartCandidate(spec runner.Spec) error
	DiscardCandidate(key string) error
	Promote(key string, grace time.Duration) error
}

// releaseMount is where an app's release appears inside its container, and
// its working directory.
const releaseMount = "/app"

/*
containerSpec turns an instance into what the Docker runner starts.

  - The release is mounted read-only at /app, resolved through `current` first,
    so the container keeps the release it was started on when a later deploy
    moves the symlink: a running process never sees its code change under it.
  - Each writable path is mounted at the SAME path inside the container. The
    values Bay already wrote into the app's .env (`DATABASE_URL`,
    `STORAGE_PATH`, `DATA_DIR`) name host paths, and this keeps every one of
    them true without rewriting the file, and keeps the backup reading the
    database where it always has.
  - `SERVER_HOST` is `0.0.0.0` inside the container: its loopback is not the
    host's, so an app bound to 127.0.0.1 there could never be reached. The
    port is published on the HOST's loopback only (see runner.createBody), so
    nothing outside the machine gains a way in.
*/
func (s *server) containerSpec(app state.App, m *manifest.Manifest, env map[string]string, instance string, writable []string) (runner.Spec, runtimeChoice, error) {
	sel, err := s.runtimeSelection(app)
	if err != nil {
		return runner.Spec{}, runtimeChoice{}, err
	}
	release, err := filepath.EvalSymlinks(filepath.Join(instance, "current"))
	if err != nil {
		return runner.Spec{}, runtimeChoice{}, fmt.Errorf("resolve current release of %s: %w", app.Key(), err)
	}

	user, err := s.appUser(app, writable)
	if err != nil {
		return runner.Spec{}, runtimeChoice{}, err
	}

	mounts := []runner.Mount{{Source: release, Target: releaseMount, ReadOnly: true}}
	for _, p := range writable {
		mounts = append(mounts, runner.Mount{Source: p, Target: p})
	}

	containerEnv := make(map[string]string, len(env)+1)
	for k, v := range env {
		containerEnv[k] = v
	}
	containerEnv["SERVER_HOST"] = "0.0.0.0"

	spec := runner.Spec{
		Key:     app.Key(),
		Runtime: m.Runtime,
		Entry:   m.Entry,
		Env:     containerEnv,
		Sandbox: runner.Container{
			Image:       sel.Ref,
			WorkDir:     releaseMount,
			Mounts:      mounts,
			Port:        app.Port,
			HostPort:    app.UpstreamPort(),
			MemoryBytes: memoryOf(app),
			PidsLimit:   256,
			NanoCPUs:    nanoCPUsFor(runtime.NumCPU()),
			StopGrace:   stopGrace,
			// The defaults, each lifted only by `bay harden --relax`.
			User:             user,
			ReadOnlyRootfs:   !relaxed(app, relaxWritableRootfs),
			DropCapabilities: !relaxed(app, relaxCapabilities),
		},
	}
	return spec, runtimeChoice{Ref: sel.Ref, Warning: sel.Warning}, nil
}

// runtimeChoice is what containerSpec decided about the image, for whoever
// started the app to report.
type runtimeChoice struct {
	Ref     string
	Warning string
}

/*
prepareRuntime pulls the image an instance will start on, while its current
process is still serving.

Called before a restart stops the old process, so the stop-to-ready window
never includes a registry download. A no-op for a runner that does not run
images, and for an image already present.
*/
func (s *server) prepareRuntime(app state.App) error {
	cr, ok := s.runner.(containerRunner)
	if !ok || app.Static {
		return nil
	}
	spec, _, err := s.specFor(app)
	if err != nil {
		return err
	}
	c := spec.Sandbox.(runner.Container)
	if authed, ok := s.runner.(interface {
		EnsureImageAuth(image, auth string) error
	}); ok {
		return authed.EnsureImageAuth(c.Image, c.RegistryAuth)
	}
	return cr.EnsureImage(c.Image)
}

// taskRunner runs a command to completion in an image: the Docker runner.
type taskRunner interface {
	RunOnce(image string, cmd []string, mounts []runner.Mount, timeout time.Duration) ([]byte, error)
}

/*
imageInterpreter runs the backup helper in the app's runtime image.

The script is written under Bay's own scratch directory, which the daemon can
mount because it is on the host's disk, and every path argument's directory is
mounted at the same path, so the helper reads and writes exactly the files it
was given. Nothing else of the host is visible to it, and it has no network.
*/
type imageInterpreter struct {
	tasks   taskRunner
	image   string
	command string // "node" or "bun", as the manifest names it
	scratch string
}

// imageTaskTimeout bounds a helper run when the caller set no deadline.
const imageTaskTimeout = 10 * time.Minute

func (i *imageInterpreter) Run(ctx context.Context, script string, args ...string) ([]byte, error) {
	if err := os.MkdirAll(i.scratch, 0o700); err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp(i.scratch, "helper-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "helper.js")
	if err := os.WriteFile(path, []byte(script), 0o644); err != nil {
		return nil, err
	}

	mounts := []runner.Mount{{Source: dir, Target: dir, ReadOnly: true}}
	seen := map[string]bool{dir: true}
	for _, arg := range args {
		if !filepath.IsAbs(arg) {
			continue
		}
		parent := filepath.Dir(arg)
		if seen[parent] {
			continue
		}
		seen[parent] = true
		mounts = append(mounts, runner.Mount{Source: parent, Target: parent})
	}

	timeout := imageTaskTimeout
	if deadline, ok := ctx.Deadline(); ok {
		timeout = time.Until(deadline)
	}
	return i.tasks.RunOnce(i.image, append([]string{i.command, path}, args...), mounts, timeout)
}

/*
replace swaps an instance's running container for a fresh one without a gap:
blue/green.

The next container starts beside the live one on a free host port and is
health-checked there while the live one keeps serving. Only once it is ready
are requests held, the store pointed at the new port (which is what the proxy
dials), and the old container drained and removed; the new one then takes the
instance's name. A candidate that never becomes ready is discarded, and the
live container never noticed.

The app's own port does not change: inside every container it listens on its
SERVER_PORT, and only the host-side publication moves.
*/
func (s *server) replace(app state.App) error {
	cr, ok := s.runner.(containerRunner)
	if !ok {
		return fmt.Errorf("%s: blue/green needs a container runner", app.Key())
	}
	spec, choice, err := s.specFor(app)
	if err != nil {
		return err
	}
	candidate, err := deploy.AllocatePort(s.store.UsedPorts())
	if err != nil {
		return err
	}
	c := spec.Sandbox.(runner.Container)
	c.HostPort = candidate
	spec.Sandbox = c

	if err := cr.StartCandidate(spec); err != nil {
		_ = cr.DiscardCandidate(app.Key())
		return err
	}
	wait := readyTimeout
	if s.readyWait > 0 {
		wait = s.readyWait
	}
	if err := s.waitReady(app, candidate, true, wait); err != nil {
		_ = cr.DiscardCandidate(app.Key())
		return fmt.Errorf("%s never became ready (the previous container is still serving): %w", app.Key(), err)
	}

	// The switch itself. Held, so a request arriving between the port change
	// and the old container's exit waits rather than meeting either a closed
	// port or a draining process.
	release := s.holdDuring(app.Key())
	defer release()
	if err := s.store.SetHostPort(app.Key(), candidate); err != nil {
		_ = cr.DiscardCandidate(app.Key())
		return err
	}
	if err := cr.Promote(app.Key(), stopGrace); err != nil {
		return fmt.Errorf("%s: serving from the new container, but the old one did not go away cleanly: %w", app.Key(), err)
	}
	if choice.Warning != "" {
		s.log.Warn("runtime image chosen for the app", "app", app.Key(), "image", choice.Ref, "warning", choice.Warning)
	}
	s.log.Info("app ready", "app", app.Key(), "port", candidate, "domain", app.Domain())
	return nil
}

/*
restart brings an instance back on its current release and environment.

Blue/green when it runs in a container and is up, so a restart, an env change
or a runtime update costs no request; stop then start otherwise (the app was
down anyway, or the runner cannot run two copies).
*/
func (s *server) restart(app state.App) error {
	// A Compose service is restarted by Compose, in place: it has no
	// artifact to start a second copy of.
	if app.ServiceKind == "service" {
		se, _ := s.store.StackEnv(app.Stack, app.Env)
		return stack.RestartService(stack.RevisionDir(s.root, app.Stack, app.Env, se.Revision),
			naming.StackProject(app.Stack, app.Env), app.Service)
	}
	if _, ok := s.runner.(containerRunner); ok && !app.Static && s.runner.Running(app.Key()) {
		return s.replace(app)
	}
	if err := s.prepareRuntime(app); err != nil {
		return err
	}
	release := s.holdDuring(app.Key())
	defer release()
	if err := s.runner.Stop(app.Key(), stopGrace); err != nil {
		return err
	}
	return s.start(app)
}

// The hardening defaults an archive app may have lifted, by name.
const (
	relaxWritableRootfs = "writable-rootfs"
	relaxCapabilities   = "capabilities"
)

func relaxed(app state.App, what string) bool {
	for _, r := range app.Relaxed {
		if r == what {
			return true
		}
	}
	return false
}

/*
appUser is the uid:gid an archive app's container runs as.

Its own uid, allocated once and kept (state.EnsureUID), and its writable paths
handed to it, so the app can write its database and nothing it was not given.
That is the isolation the per-app unix user gave under systemd: one app's
compromise reaches that app's files, not the others'.

When Bay itself is not root (development, the test suites), it cannot hand
files to another uid, so the container runs as Bay's own user instead; that is
said once in the log rather than failing.
*/
func (s *server) appUser(app state.App, writable []string) (string, error) {
	if os.Geteuid() != 0 {
		return fmt.Sprintf("%d:%d", os.Getuid(), os.Getgid()), nil
	}
	uid, err := s.store.EnsureUID(app.Key())
	if err != nil {
		return "", err
	}
	for _, p := range writable {
		if err := os.MkdirAll(p, 0o755); err != nil {
			return "", err
		}
		if err := chownTree(p, uid); err != nil {
			return "", fmt.Errorf("hand %s to the app's uid %d: %w", p, uid, err)
		}
	}
	return fmt.Sprintf("%d:%d", uid, uid), nil
}

// chownTree gives a directory and everything under it to uid:uid, without
// following symlinks.
func chownTree(root string, uid int) error {
	return filepath.Walk(root, func(path string, _ os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		return os.Lchown(path, uid, uid)
	})
}

// defaultMemory is every app's memory ceiling unless `bay harden --memory`
// says otherwise: enough for an Alepha app, small enough that one leaking app
// cannot take a small VPS down with it.
const defaultMemory = 512 << 20

func memoryOf(app state.App) int64 {
	if app.MemoryBytes > 0 {
		return app.MemoryBytes
	}
	return defaultMemory
}

/*
parseMemory reads a size the way Docker's own flags do: a number with a k, m or
g suffix (binary units), "default" for Bay's default.

Bounded on purpose: under 64 MiB a Node process does not boot, and a typo in
the other direction ("80g" for "8g") must not quietly lift the one protection
a shared host has.
*/
func parseMemory(raw string) (int64, error) {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "default" || raw == "" {
		return 0, nil
	}
	units := map[byte]int64{'k': 1 << 10, 'm': 1 << 20, 'g': 1 << 30}
	unit, ok := units[raw[len(raw)-1]]
	if !ok {
		return 0, fmt.Errorf("memory %q: give a size like 768m or 2g, or default", raw)
	}
	n, err := strconv.ParseFloat(raw[:len(raw)-1], 64)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("memory %q: give a size like 768m or 2g, or default", raw)
	}
	bytes := int64(n * float64(unit))
	if bytes < 64<<20 || bytes > 64<<30 {
		return 0, fmt.Errorf("memory %q is outside 64m..64g", raw)
	}
	return bytes, nil
}
