// Package runner starts and stops app processes.
//
// Two implementations: systemd units on Linux (cgroups, MemoryMax, journald,
// Restart=always come free) and plain child processes elsewhere, so `bay`
// stays developable on macOS. The interface is what matters.
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
// full sandbox) and plain child processes elsewhere, so Bay runs on a
// laptop. Only the first is safe for multi-app hosting.
type Runner interface {
	Start(spec Spec) error
	Stop(key string, grace time.Duration) error
	Running(key string) bool
	StopAll(grace time.Duration)
	// Usage reports what the supervisor knows about the app right now, or
	// false when it knows nothing — an unsupervised child process, an app that
	// is not running, a host without cgroups.
	Usage(key string) (Usage, bool)
	// Logs returns the last n entries this supervisor has for the app, and
	// whether it supervises it at all.
	//
	// The bool carries the distinction that matters when nothing comes back:
	// "this Bay has never started that app" and "it started and said nothing"
	// send an operator to two different places, and an empty slice alone cannot
	// tell them apart.
	Logs(key string, n int) ([]LogLine, bool, error)
}

/*
Usage reports nothing for a plain child process.

Bay could read /proc for an RSS figure, but a child inherits Bay's own limits
and shares its cgroup, so there is no memory budget to report it against and no
restart count to report at all. Half a measurement presented as a full one is
how an operator ends up trusting a number that means something else.
*/
func (c *Child) Usage(string) (Usage, bool) { return Usage{}, false }

// Logs reads back what the child wrote to its log file.
//
// Both stdout and stderr land in the same file, in the order the process wrote
// them, which is the order that makes a crash readable: the stack trace belongs
// directly after the request that caused it, and splitting the streams would
// put them in two places with no way to interleave them again.
func (c *Child) Logs(key string, n int) ([]LogLine, bool, error) {
	c.mu.Lock()
	path, ok := c.logFiles[key]
	c.mu.Unlock()
	if !ok {
		return nil, false, nil
	}
	lines, err := TailFile(path, n)
	return lines, true, err
}

// Child supervises plain child processes.
//
// ⚠ No isolation whatsoever: children inherit Bay's privileges, so on a host
// running Bay as root every app is root. Acceptable for local development, never
// for a machine hosting more than one app.
type Child struct {
	mu    sync.Mutex
	procs map[string]*exec.Cmd
	// logFiles remembers where each app's output went.
	//
	// Deliberately NOT deleted when the process exits, unlike procs: the log of
	// an app that just died is the single most useful thing on the machine, and
	// forgetting the path at exit would make it unreachable exactly when it is
	// wanted.
	logFiles map[string]string
}

func NewChild() *Child {
	return &Child{
		procs:    make(map[string]*exec.Cmd),
		logFiles: make(map[string]string),
	}
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
	if err := rotateIfLarge(s.LogFile, maxLogBytes); err != nil {
		return fmt.Errorf("rotate log: %w", err)
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
	r.logFiles[s.Key] = s.LogFile

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
// No shell expansion, because a secret containing `$` must survive intact.
// Quoting and escapes follow [UnquoteEnvValue], which is the same grammar
// systemd's EnvironmentFile uses and the same one [QuoteEnvValue] writes.
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
	// The same ceiling as deploy.ParseAssignments (1 MiB): `bay env set`
	// accepts a PEM key or a service-account JSON, and the default 64 KiB
	// token made every later read of the file fail with "token too long",
	// which left the instance unable to start.
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
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
		env[key] = UnquoteEnvValue(value)
	}
	return env, sc.Err()
}
