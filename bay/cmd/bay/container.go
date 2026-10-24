package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/alepha-dev/bay/internal/manifest"
	"github.com/alepha-dev/bay/internal/runner"
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
			MemoryBytes: 512 << 20,
			PidsLimit:   256,
			NanoCPUs:    nanoCPUsFor(runtime.NumCPU()),
			StopGrace:   stopGrace,
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
	sel, err := s.runtimeSelection(app)
	if err != nil {
		return err
	}
	return cr.EnsureImage(sel.Ref)
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
