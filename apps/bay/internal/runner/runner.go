// Package runner starts and stops app processes.
//
// On Linux the real implementation will generate systemd units (cgroups,
// MemoryMax, journald, Restart=always come free). This PoC ships the child
// process variant so `bay` is developable on macOS — the interface is what
// matters, systemd slots in behind it.
package runner

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Spec is everything needed to launch one app instance.
type Spec struct {
	Key     string            // "lore/production"
	Dir     string            // release directory (the process cwd)
	Runtime string            // absolute path to the node/bun binary
	Entry   string            // "dist"
	Env     map[string]string // resolved environment
	LogFile string
	// Sandbox carries backend-specific isolation settings. The systemd backend
	// requires it; the child-process backend ignores it, because a plain child
	// cannot be sandboxed — which is exactly why systemd is the real target.
	Sandbox any
}

// Runner supervises app processes.
//
// Two implementations: systemd on Linux (per-app unix user, cgroups, journald,
// full sandbox) and plain child processes elsewhere, so `bay dev` works on a
// laptop. Only the first is safe for multi-app hosting.
type Runner interface {
	Start(spec Spec) error
	Stop(key string, grace time.Duration) error
	Running(key string) bool
	StopAll(grace time.Duration)
}

// Child supervises plain child processes.
//
// ⚠ No isolation whatsoever: children inherit Bay's privileges, so on a host
// running Bay as root every app is root. Acceptable for local development, never
// for a machine hosting more than one app.
type Child struct {
	mu    sync.Mutex
	procs map[string]*exec.Cmd
}

func NewChild() *Child {
	return &Child{procs: make(map[string]*exec.Cmd)}
}

// Start launches the app and returns once the process is spawned.
//
// It does NOT wait for readiness — that is the health check's job, and
// conflating the two is how you end up routing traffic at a process that is
// still running migrations.
func (r *Child) Start(s Spec) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, running := r.procs[s.Key]; running {
		return fmt.Errorf("%s is already running", s.Key)
	}

	cmd := exec.Command(s.Runtime, s.Entry)
	cmd.Dir = s.Dir
	cmd.Env = flatten(s.Env)
	// Own process group, so stopping the app also stops anything it spawned
	// instead of leaving orphans behind.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	if err := os.MkdirAll(filepath.Dir(s.LogFile), 0o755); err != nil {
		return err
	}
	log, err := os.OpenFile(s.LogFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return fmt.Errorf("open log: %w", err)
	}
	cmd.Stdout = log
	cmd.Stderr = log

	if err := cmd.Start(); err != nil {
		log.Close()
		return fmt.Errorf("start %s: %w", s.Key, err)
	}
	r.procs[s.Key] = cmd

	go func() {
		_ = cmd.Wait()
		log.Close()
		r.mu.Lock()
		delete(r.procs, s.Key)
		r.mu.Unlock()
	}()
	return nil
}

// Stop terminates an app gracefully, then forcefully.
//
// SIGTERM first and a real grace period: Alepha stops accepting, finishes
// in-flight requests and jobs, then exits. This is what makes stopping an app
// safe even when we were wrong about it being idle — the `idle` flag is only an
// optimisation, graceful shutdown is the actual guarantee.
func (r *Child) Stop(key string, grace time.Duration) error {
	r.mu.Lock()
	cmd, ok := r.procs[key]
	r.mu.Unlock()
	if !ok {
		return nil
	}
	pgid, err := syscall.Getpgid(cmd.Process.Pid)
	if err != nil {
		pgid = cmd.Process.Pid
	}
	_ = syscall.Kill(-pgid, syscall.SIGTERM)

	deadline := time.Now().Add(grace)
	for time.Now().Before(deadline) {
		r.mu.Lock()
		_, still := r.procs[key]
		r.mu.Unlock()
		if !still {
			return nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	_ = syscall.Kill(-pgid, syscall.SIGKILL)
	return nil
}

// Running reports whether the app currently has a live process.
func (r *Child) Running(key string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.procs[key]
	return ok
}

// StopAll shuts every supervised app down, used on bay's own exit.
func (r *Child) StopAll(grace time.Duration) {
	r.mu.Lock()
	keys := make([]string, 0, len(r.procs))
	for k := range r.procs {
		keys = append(keys, k)
	}
	r.mu.Unlock()
	for _, k := range keys {
		_ = r.Stop(k, grace)
	}
}

func flatten(env map[string]string) []string {
	out := make([]string, 0, len(env)+2)
	// PATH is needed for the runtime to find its own helpers; everything else is
	// deliberately NOT inherited, so an app never sees Bay's environment.
	out = append(out, "PATH="+os.Getenv("PATH"))
	out = append(out, "HOME="+os.Getenv("HOME"))
	for k, v := range env {
		out = append(out, k+"="+v)
	}
	return out
}

// LoadEnvFile parses a .env file into a map.
//
// Values are taken literally apart from optional surrounding quotes; no shell
// expansion, because a secret containing `$` must survive intact.
func LoadEnvFile(path string) (map[string]string, error) {
	env := map[string]string{}
	f, err := os.Open(path)
	if os.IsNotExist(err) {
		return env, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') ||
				(value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		env[key] = value
	}
	return env, sc.Err()
}
