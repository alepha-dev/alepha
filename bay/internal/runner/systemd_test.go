//go:build linux

package runner

import (
	"strings"
	"testing"
	"time"
)

// renderSandbox renders the demo unit with `adjust` applied to the sandbox, so
// a test can vary one directive without restating the whole spec.
func renderSandbox(t *testing.T, adjust func(*Sandbox)) string {
	t.Helper()
	sandbox := Sandbox{
		Instance:      "/opt/bay/data/apps/demo/production",
		WritablePaths: []string{"/opt/bay/data/apps/demo/production/scratch"},
		MemoryMax:     "512M",
		StopGrace:     30 * time.Second,
	}
	if adjust != nil {
		adjust(&sandbox)
	}
	s := &Systemd{UnitDir: t.TempDir()}
	return s.render(
		Spec{
			Key:     "demo/production",
			Dir:     "/opt/bay/data/apps/demo/production/current",
			Runtime: "/opt/bay/runtimes/node/bin/node",
			Entry:   "index.js",
			LogFile: "/opt/bay/data/apps/demo/production/logs/app.log",
		},
		sandbox,
		"bay-demo-production",
	)
}

func renderUnitWith(t *testing.T, stopGrace time.Duration) string {
	t.Helper()
	return renderSandbox(t, func(s *Sandbox) { s.StopGrace = stopGrace })
}

func renderUnit(t *testing.T) string {
	t.Helper()
	return renderUnitWith(t, 30*time.Second)
}

func TestUnitCapsTheStopTimeout(t *testing.T) {
	/*
		systemd waits 90 seconds by default for a process that does not answer
		SIGTERM. An app with a wedged event loop is exactly that — and it is
		also the app most likely to be rolled back, so the wait lands precisely
		when the site is already down.

		Measured at 92 seconds during a rollback test on a real host: the
		verdict was reached in 45 seconds and the recovery took another 92,
		nearly all of it systemd waiting on a process that was never going to
		answer.
	*/
	unit := renderUnitWith(t, 30*time.Second)

	if !strings.Contains(unit, "TimeoutStopSec=30") {
		t.Fatalf("the grace the caller asked for must reach the unit:\n%s", unit)
	}
}

func TestUnitCapsTheStopTimeoutEvenWhenNobodyAskedFor(t *testing.T) {
	/*
		A caller that leaves StopGrace at zero used to get no `TimeoutStopSec`
		line at all — which means systemd's 90-second default, which is the bug
		this was added to fix. "The field was left unset" and "the bug is back"
		were the same thing, and nothing said so.

		This test exists because the first version of the one above passed a
		zero-valued Sandbox and asserted only that the directive appeared
		somewhere. It failed on CI, on Linux, where the code it covers actually
		compiles.
	*/
	unit := renderUnitWith(t, 0)

	if !strings.Contains(unit, "TimeoutStopSec=30") {
		t.Fatalf("a unit with no explicit grace must still be capped:\n%s", unit)
	}
}

func TestUnitKeepsRestartingACrashedApp(t *testing.T) {
	// The other half of the same story: Bay is not a supervisor, systemd is.
	// An app that dies has to come back without anyone deploying it.
	unit := renderUnit(t)

	if !strings.Contains(unit, "Restart=always") {
		t.Error("a crashed app must come back on its own")
	}
	if !strings.Contains(unit, "RestartSec=") {
		t.Error("restarting with no delay is how a crash loop pegs a core")
	}
}

func TestUnitSandboxesTheApp(t *testing.T) {
	// These lines are the difference between one compromised app and the whole
	// host. Asserted by name because losing one silently costs nothing at
	// deploy time and everything later.
	unit := renderUnit(t)

	for _, directive := range []string{
		"NoNewPrivileges=yes",
		"ProtectSystem=strict",
		"ProtectHome=yes",
		"PrivateTmp=yes",
		"MemoryMax=512M",
	} {
		if !strings.Contains(unit, directive) {
			t.Errorf("missing sandbox directive %q", directive)
		}
	}
}

func TestUnitCapsCPUSoOneAppCannotTakeTheMachine(t *testing.T) {
	/*
		MemoryMax already stops one app from eating the host's RAM. Nothing
		stopped it from eating the host's CPU — and on a two-core VPS a single
		prototype in a tight loop degrades every other app AND Bay's own proxy,
		which is the part that turns one broken app into a site-wide outage.

		A ceiling rather than a share: `CPUWeight` is the default 100 for every
		unit, so setting it uniformly changes nothing. Only a quota does work
		when every app is configured identically.
	*/
	unit := renderSandbox(t, func(s *Sandbox) { s.CPUQuota = "100%" })

	if !strings.Contains(unit, "CPUQuota=100%") {
		t.Fatalf("the CPU ceiling the caller asked for must reach the unit:\n%s", unit)
	}
}

func TestUnitOmitsCPUQuotaWhenUnset(t *testing.T) {
	/*
		The failure this forbids is not a missing limit, it is a rendered one:
		`CPUQuota=0%` grants the app NO cpu time at all, so it would never
		finish booting and Bay would report "never became ready" for a reason
		nothing in the logs connects to a quota.

		An unset field must therefore produce no line, leaving systemd's own
		default — unlimited. Same shape as MemoryMax and TasksMax above.
	*/
	unit := renderSandbox(t, nil)

	if strings.Contains(unit, "CPUQuota=") {
		t.Fatalf("an unset quota must emit no directive at all:\n%s", unit)
	}
}

func TestUnitDoesNotPutSecretsInTheUnitFile(t *testing.T) {
	// The app's secrets live in its .env, read by systemd at start and readable
	// only by the app's own user. Passing them as Environment= would expose
	// them in `systemctl show` and in a world-readable unit file.
	unit := renderUnit(t)

	if !strings.Contains(unit, "EnvironmentFile=") {
		t.Fatal("secrets must come from the .env, not from the unit")
	}
	if strings.Contains(unit, "\nEnvironment=") {
		t.Fatal("Environment= exposes secrets in `systemctl show`")
	}
}
