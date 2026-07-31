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

	"github.com/alepha/bay/internal/control"
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
}

func NewSystemd(unitDir string) *Systemd {
	if unitDir == "" {
		unitDir = "/etc/systemd/system"
	}
	return &Systemd{UnitDir: unitDir}
}

// Sandbox describes what an app is allowed to write, derived from its manifest.
//
// Declaring `$bucket` in application code is what grants write access to the
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
	// ControlSocketDir is the directory holding the control socket. Added to the
	// writable paths ONLY for a granted app.
	//
	// Connecting to a unix socket needs write access to its inode, and
	// `ProtectSystem=strict` mounts everything read-only — so a granted app
	// cannot reach the socket without this. A separate directory from the state
	// root on purpose: granting write access to `/opt/bay/data` would hand the
	// app `state.json`, which holds the control token and the S3 credentials. The
	// grant must widen exactly one thing.
	ControlSocketDir string
	// ControlGroup, when set, is added as a supplementary group so the app can
	// reach Bay's control socket.
	//
	// Emitted into the unit rather than only applied with `usermod` so the grant
	// is legible where an operator looks: `systemctl cat` shows, in one line,
	// that this app administers its own host. A privilege that only exists in
	// /etc/group is a privilege nobody reviews.
	ControlGroup string
}

func unitName(key string) string {
	// "lore/production" -> "bay-lore-production"
	return "bay-" + strings.ReplaceAll(key, "/", "-")
}

// UserName returns the dedicated unix user for an app instance.
func UserName(key string) string {
	name := unitName(key)
	// useradd refuses names over 32 characters on most systems.
	if len(name) > 32 {
		name = name[:32]
	}
	return name
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
	if sandbox.ControlGroup != "" {
		// systemd resolves SupplementaryGroups at start, so the group must exist
		// first — otherwise the unit refuses to start with a message about an
		// unknown group rather than about the grant.
		if err := control.EnsureGroupExists(sandbox.ControlGroup); err != nil {
			return fmt.Errorf("control group for %s: %w", spec.Key, err)
		}
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

	unit := s.render(spec, sandbox, user)
	path := filepath.Join(s.UnitDir, unitName(spec.Key)+".service")
	if err := writeFileAtomic(path, unit, 0o644); err != nil {
		return err
	}
	if out, err := exec.Command("systemctl", "daemon-reload").CombinedOutput(); err != nil {
		return fmt.Errorf("daemon-reload: %w: %s", err, out)
	}
	// Clear a previous start-limit hit. An app that crash-looped — a bad release,
	// a missing directory — trips systemd's rate limiter, and the unit then stays
	// in `failed` refusing to start even once the cause is fixed. Without this a
	// deploy cannot repair a crash loop, and the operator has to SSH in to run
	// `reset-failed` by hand, which is exactly the intervention Bay exists to
	// remove. Errors ignored: nothing to reset is the normal case.
	_ = exec.Command("systemctl", "reset-failed", unitName(spec.Key)).Run()
	if out, err := exec.Command("systemctl", "restart", unitName(spec.Key)).CombinedOutput(); err != nil {
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
	if sandbox.StopGrace > 0 {
		// The one number that governs shutdown. Bay's own `grace` argument used
		// to be a separate value that `Stop` silently ignored, so the timeout
		// actually in force was systemd's 90-second default — measured at 92
		// seconds holding up a rollback on a real host.
		w("TimeoutStopSec=%d", int(sandbox.StopGrace.Seconds()))
	}
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
	if sandbox.ControlGroup != "" {
		if sandbox.ControlSocketDir != "" {
			// Connecting needs write access on the socket inode, and
			// ProtectSystem=strict makes everything read-only.
			w("ReadWritePaths=%s", sandbox.ControlSocketDir)
		}
		w("")
		w("# ⚠ ROOT-EQUIVALENT. This app may call Bay's control API: deploy code,")
		w("# read every other app's secrets, delete every backup. Granted by the")
		w("# operator with `--allow-control-api`, never by the artifact.")
		w("SupplementaryGroups=%s", sandbox.ControlGroup)
	}
	if sandbox.MemoryMax != "" {
		w("MemoryMax=%s", sandbox.MemoryMax)
	}
	if sandbox.TasksMax > 0 {
		w("TasksMax=%d", sandbox.TasksMax)
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

// stopCallMargin is how much longer than the unit's own grace Bay waits for
// `systemctl stop` to return. Enough for systemd to send SIGKILL and reap;
// short enough that a broken systemd does not wedge a deploy.
const stopCallMargin = 10 * time.Second

// Running reports whether systemd considers the unit active.
func (s *Systemd) Running(key string) bool {
	out, _ := exec.Command("systemctl", "is-active", unitName(key)+".service").Output()
	return strings.TrimSpace(string(out)) == "active"
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
