//go:build linux

package runner

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Systemd supervises apps as systemd units.
//
// This is where the isolation lives. Running every app as root — which the child
// process runner does — means one app's remote-code-execution bug hands the
// attacker every other app's secrets, every other app's database, Bay's control
// token and the backup credentials. A unix user per app instance plus systemd's
// sandbox directives is what turns that from "the whole fleet" into "that one
// app's own files".
//
// It also brings cgroups (MemoryMax), journald, restart backoff and socket
// handling for free — all things the child runner cannot do.
type Systemd struct {
	// UnitDir is where generated units are written, normally
	// /etc/systemd/system.
	UnitDir string
	// run executes an external command. nil means the real one; the
	// lifecycle helpers in systemdcmd.go take it as a parameter so their
	// argv can be asserted on a host with no systemd. See that file.
	run commandRunner
}

func NewSystemd(unitDir string) *Systemd {
	if unitDir == "" {
		unitDir = "/etc/systemd/system"
	}
	return &Systemd{UnitDir: unitDir}
}

// exec is the real command runner, and what `run` falls back to.
func (s *Systemd) exec(name string, args ...string) ([]byte, error) {
	if s.run != nil {
		return s.run(name, args...)
	}
	return exec.Command(name, args...).CombinedOutput()
}

// Sandbox describes what an app is allowed to write, derived from its manifest.
//
// Declaring `$storage` in application code is what grants write access to the
// storage directory; not declaring it denies it. Least privilege as a
// consequence of the code, with no configuration file anywhere.
type Sandbox struct {
	// Instance is the per-app directory holding data/, storage/, .env, releases/.
	Instance string
	// WritablePaths are the only paths the app may write to.
	WritablePaths []string
	// MemoryMax is a systemd memory limit, e.g. "512M". Empty means unlimited.
	MemoryMax string
	// TasksMax caps thread/process count. Zero means the systemd default.
	TasksMax int
	// CPUQuota is a cgroup CPU ceiling, in systemd's spelling: a percentage of
	// ONE core, so "200%" is two full cores. Empty means unlimited.
	//
	// MemoryMax already stops one app from eating the host's RAM; without this
	// nothing stopped it eating the host's CPU. On a small VPS a single app in a
	// tight loop degrades every other app AND Bay's own proxy — which is what
	// turns one broken prototype into a site-wide outage.
	//
	// A ceiling and not a share, deliberately. `CPUWeight` defaults to 100 on
	// every unit, so setting it identically everywhere changes nothing; weights
	// only do work when they differ. A quota is the one knob that still protects
	// the host when every app is configured the same way.
	CPUQuota string
	// StopGrace is how long the app gets to shut down cleanly after SIGTERM,
	// before systemd kills it.
	//
	// An Alepha app traps SIGTERM and runs its `stop` hooks: the HTTP server
	// refuses new connections and waits out the in-flight ones (10s by
	// default), then database pools close and buffered telemetry flushes. Cut
	// that short and a request in progress dies mid-response.
	//
	// Zero leaves systemd's default of 90 seconds — which is the opposite
	// problem. An app whose event loop is wedged never answers SIGTERM at all,
	// and it is also the app most likely to be rolled back, so the full 90
	// seconds gets spent with the site down.
	StopGrace time.Duration
}

// EnsureUser creates the app's unix user if it does not exist.
//
// System account, no home, no login shell: it exists to own files and run one
// process, never to be logged into.
func EnsureUser(user string) error {
	if _, err := exec.Command("id", "-u", user).Output(); err == nil {
		return nil // already there
	}
	cmd := exec.Command("useradd",
		"--system",
		"--no-create-home",
		"--shell", "/usr/sbin/nologin",
		user,
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("create user %s: %w: %s", user, err, strings.TrimSpace(string(out)))
	}
	return nil
}

// Chown hands the app's durable files to its user.
//
// The release directory deliberately stays root-owned and only readable: an app
// that can rewrite its own code can persist across a redeploy.
func Chown(user string, paths ...string) error {
	for _, p := range paths {
		if _, err := os.Stat(p); os.IsNotExist(err) {
			continue
		}
		if out, err := exec.Command("chown", "-R", user+":"+user, p).CombinedOutput(); err != nil {
			return fmt.Errorf("chown %s: %w: %s", p, err, strings.TrimSpace(string(out)))
		}
	}
	return nil
}

// Start writes the unit and starts it.
func (s *Systemd) Start(spec Spec) error {
	sandbox, ok := spec.Sandbox.(Sandbox)
	if !ok {
		return fmt.Errorf("systemd runner needs a Sandbox for %s", spec.Key)
	}
	user := UserName(spec.Key)
	if err := EnsureUser(user); err != nil {
		return err
	}
	// Every ReadWritePaths entry must exist, or systemd refuses to start the unit
	// with `Failed to set up mount namespacing` — a message that says nothing
	// about which path or why. Creating them here rather than tolerating absence
	// with a `-` prefix: a missing directory is a real problem and should be
	// fixed, not hidden.
	//
	// This matters for apps provisioned before a sandbox path was introduced: a
	// fresh install would never hit it, an upgrade always would.
	for _, p := range sandbox.WritablePaths {
		if err := os.MkdirAll(p, 0o755); err != nil {
			return fmt.Errorf("create writable path %s: %w", p, err)
		}
	}
	if err := Chown(user, append([]string{}, sandbox.WritablePaths...)...); err != nil {
		return err
	}
	// The env file holds the app's secrets: readable by its own user, nobody
	// else. Not via systemd's Environment=, which would expose them in
	// `systemctl show` and in a world-readable unit file.
	envPath := filepath.Join(sandbox.Instance, ".env")
	if err := Chown(user, envPath); err != nil {
		return err
	}
	if err := os.Chmod(envPath, 0o600); err != nil && !os.IsNotExist(err) {
		return err
	}

	// Checked here rather than left to systemd: it answers an unreachable
	// WorkingDirectory with `status=200/CHDIR`, Bay turns that into "never
	// became ready", and neither sentence mentions a directory mode. The app
	// logs nothing either, because it never ran.
	if err := AssertReachable(user, spec.Dir); err != nil {
		return err
	}

	unit := s.render(spec, sandbox, user)
	path := filepath.Join(s.UnitDir, unitName(spec.Key)+".service")
	if err := writeFileAtomic(path, unit, 0o644); err != nil {
		return err
	}
	if out, err := s.exec("systemctl", "daemon-reload"); err != nil {
		return fmt.Errorf("daemon-reload: %w: %s", err, out)
	}
	// Without this the app does not come back after a reboot. The unit has
	// rendered a correct `[Install] WantedBy=multi-user.target` all along —
	// nothing ever acted on it, so systemd had a unit it knew how to enable
	// and was never asked to. `restart` below starts it for the current boot
	// and says nothing about the next one.
	//
	// Before `reset-failed`/`restart`, and NOT `enable --now`: see enableUnit.
	if err := enableUnit(s.exec, unitName(spec.Key)); err != nil {
		return err
	}
	// Clear a previous start-limit hit. An app that crash-looped — a bad release,
	// a missing directory — trips systemd's rate limiter, and the unit then stays
	// in `failed` refusing to start even once the cause is fixed. Without this a
	// deploy cannot repair a crash loop, and the operator has to SSH in to run
	// `reset-failed` by hand, which is exactly the intervention Bay exists to
	// remove. Errors ignored: nothing to reset is the normal case.
	_, _ = s.exec("systemctl", "reset-failed", unitName(spec.Key))
	if out, err := s.exec("systemctl", "restart", unitName(spec.Key)); err != nil {
		return fmt.Errorf("start %s: %w: %s", unitName(spec.Key), err, out)
	}
	return nil
}

func (s *Systemd) render(spec Spec, sandbox Sandbox, user string) string {
	var b strings.Builder
	w := func(format string, args ...any) { fmt.Fprintf(&b, format+"\n", args...) }

	w("# Generated by Bay. Rewritten on every deploy — edits are lost.")
	w("[Unit]")
	w("Description=Bay app %s", spec.Key)
	w("After=network-online.target")
	w("Wants=network-online.target")
	w("")
	w("[Service]")
	w("Type=simple")
	w("User=%s", user)
	w("Group=%s", user)
	w("WorkingDirectory=%s", spec.Dir)
	w("EnvironmentFile=%s", filepath.Join(sandbox.Instance, ".env"))
	w("ExecStart=%s %s", spec.Runtime, spec.Entry)
	w("Restart=always")
	w("RestartSec=2")
	// The one number that governs shutdown. Bay's own `grace` argument used to
	// be a separate value that `Stop` silently ignored, so the timeout actually
	// in force was systemd's 90-second default — measured at 92 seconds holding
	// up a rollback on a real host.
	//
	// Always emitted, never conditional on the caller having set it: a unit
	// without this line falls back to those 90 seconds, so "the field was left
	// at zero" and "the bug is back" would be the same thing, and nothing would
	// say so.
	w("TimeoutStopSec=%d", int(stopGraceOf(sandbox).Seconds()))
	w("")
	w("# Sandbox. Everything below is the difference between one compromised app")
	w("# and the whole host.")
	w("NoNewPrivileges=yes")
	w("ProtectSystem=strict")
	w("ProtectHome=yes")
	w("PrivateTmp=yes")
	w("ProtectKernelTunables=yes")
	w("ProtectKernelModules=yes")
	w("ProtectControlGroups=yes")
	w("RestrictSUIDSGID=yes")
	w("RestrictNamespaces=yes")
	w("LockPersonality=yes")
	w("CapabilityBoundingSet=")
	w("AmbientCapabilities=")
	w("RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX")
	for _, p := range sandbox.WritablePaths {
		// Each of these exists because the manifest declared the resource that
		// needs it. Nothing else on the filesystem is writable.
		w("ReadWritePaths=%s", p)
	}
	if sandbox.MemoryMax != "" {
		w("MemoryMax=%s", sandbox.MemoryMax)
	}
	if sandbox.TasksMax > 0 {
		w("TasksMax=%d", sandbox.TasksMax)
	}
	// Guarded on empty, and that guard is the load-bearing part: rendering an
	// unset quota would emit `CPUQuota=0%`, which grants the app no CPU time at
	// all. It would never finish booting, and the only symptom Bay could report
	// is "never became ready" — a message nothing connects back to a quota.
	if sandbox.CPUQuota != "" {
		w("CPUQuota=%s", sandbox.CPUQuota)
	}
	w("")
	w("StandardOutput=journal")
	w("StandardError=journal")
	w("")
	w("[Install]")
	w("WantedBy=multi-user.target")
	return b.String()
}

// Stop stops the unit, letting systemd apply the graceful shutdown timeout.
func (s *Systemd) Stop(key string, grace time.Duration) error {
	// systemd enforces the grace itself, from the unit's TimeoutStopSec — it
	// is the one holding the SIGTERM-then-SIGKILL clock, and `systemctl stop`
	// blocks until that clock runs out.
	//
	// The bound here is on the CALL, and it is deliberately longer: if
	// systemctl has not returned by then, systemd is not doing what its own
	// unit says, and Bay must not block on it forever with a deploy half done.
	ctx, cancel := context.WithTimeout(context.Background(), grace+stopCallMargin)
	defer cancel()

	cmd := exec.CommandContext(ctx, "systemctl", "stop",
		"--job-mode=replace",
		unitName(key)+".service",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		if ctx.Err() != nil {
			return fmt.Errorf(
				"stop %s: systemctl did not return within %s (unit grace is %s)",
				key, grace+stopCallMargin, grace)
		}
		text := strings.TrimSpace(string(out))
		// Stopping something that is not loaded is not a failure: callers stop
		// before deploying, and the first deploy has nothing to stop.
		if strings.Contains(text, "not loaded") || strings.Contains(text, "not found") {
			return nil
		}
		return fmt.Errorf("stop %s: %w: %s", key, err, text)
	}
	return nil
}

/*
stopGraceOf returns the shutdown budget for this unit.

The fallback is not a preference — it is a floor. An Alepha app answering
SIGTERM stops accepting connections and waits out the in-flight requests for up
to 10 seconds before its pools close and its buffers flush, so anything under
that cuts off a request that was already being served.
*/
func stopGraceOf(sandbox Sandbox) time.Duration {
	if sandbox.StopGrace > 0 {
		return sandbox.StopGrace
	}
	return defaultStopGrace
}

// defaultStopGrace applies when a caller did not say. See stopGraceOf.
const defaultStopGrace = 30 * time.Second

// stopCallMargin is how much longer than the unit's own grace Bay waits for
// `systemctl stop` to return. Enough for systemd to send SIGKILL and reap;
// short enough that a broken systemd does not wedge a deploy.
const stopCallMargin = 10 * time.Second

/*
Remove uninstalls the app: the unit is disabled, its file deleted, and systemd
told to forget both.

Called when an app is unregistered, after Stop. Leaving the unit behind is not
cosmetic — an enabled unit whose app Bay no longer knows about starts again at
the next reboot, and there is nothing left in the registry to explain why a
domain is being served.

`purge` mirrors the API flag and gates ONLY the unix user, which is deleted with
the data or not at all. See deleteUser for why keeping a user is the safer half
of that trade.
*/
func (s *Systemd) Remove(key string, purge bool) error {
	if err := removeUnit(s.exec, s.UnitDir, unitName(key)); err != nil {
		return err
	}
	if !purge {
		return nil
	}
	return deleteUser(s.exec, UserName(key))
}

// Running reports whether systemd considers the unit active.
func (s *Systemd) Running(key string) bool {
	out, _ := exec.Command("systemctl", "is-active", unitName(key)+".service").Output()
	return strings.TrimSpace(string(out)) == "active"
}

/*
State asks systemd what it calls the unit right now.

`show --property=ActiveState` rather than `is-active`, because `is-active`
answers `inactive` for a unit that failed and exits non-zero for both, which
loses exactly the distinction this exists for. An unreadable answer is the
empty string: the console then says nothing about the state rather than
inventing one.
*/
func (s *Systemd) State(key string) string {
	out, err := exec.Command("systemctl", "show", unitName(key)+".service",
		"--property=ActiveState").Output()
	if err != nil {
		return ""
	}
	_, value, ok := strings.Cut(strings.TrimSpace(string(out)), "=")
	if !ok {
		return ""
	}
	return value
}

/*
Usage asks systemd what the unit is costing.

One `systemctl show` rather than reading the cgroup files directly: the cgroup
path depends on the slice, on the cgroup version and on whether the unit was
delegated, and getting it wrong reports another app's numbers rather than none.
systemd already knows all of it.
*/
func (s *Systemd) Usage(key string) (Usage, bool) {
	out, err := exec.Command("systemctl", "show", unitName(key)+".service",
		"--property="+strings.Join(usageProperties, ",")).Output()
	if err != nil {
		return Usage{}, false
	}
	u := parseUsage(string(out))
	// A unit that has never run reports nothing worth showing, and a PID of
	// zero with a memory charge of zero is not a measurement.
	if u.PID == 0 && u.MemoryBytes == 0 {
		return Usage{}, false
	}
	return u, true
}

// Logs reads the unit's journal.
//
// journald rather than a file: the unit is rendered with StandardOutput=journal,
// so there is no app.log on a real host. That also means retention and rotation
// are already handled, which is why the file-based runner needed rotating and
// this one does not.
//
// `--no-pager` is not optional. journalctl pipes to a pager when it thinks it
// has a terminal, and a pager waiting for a keypress inside an HTTP handler
// hangs the control API rather than returning anything.
func (s *Systemd) Logs(key string, n int) ([]LogLine, bool, error) {
	unit := unitName(key) + ".service"
	// Asked of systemd rather than of our own state: if the unit is unknown to
	// the machine, "this Bay never started it" is the honest answer even when a
	// stale record says otherwise.
	if out, err := exec.Command("systemctl", "show", unit, "--property=LoadState").Output(); err != nil ||
		strings.Contains(string(out), "LoadState=not-found") {
		return nil, false, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "journalctl",
		"--unit", unit,
		"--output", "json",
		"--lines", fmt.Sprint(n),
		"--no-pager",
	)
	out, err := cmd.Output()
	if err != nil {
		return nil, true, fmt.Errorf("journalctl for %s: %w", unit, err)
	}
	return ParseJournal(out), true, nil
}

// StopAll is a no-op: units outlive Bay on purpose.
//
// Bay is the reverse proxy. If it crashes or is upgraded, the apps must keep
// serving — that is exactly what moving supervision to systemd buys.
func (s *Systemd) StopAll(time.Duration) {}

func writeFileAtomic(path, content string, mode os.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".unit-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.WriteString(content); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), mode); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
