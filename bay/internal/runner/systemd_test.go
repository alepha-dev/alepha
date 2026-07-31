//go:build linux

package runner

import (
	"strings"
	"testing"
)

func renderUnit(t *testing.T) string {
	t.Helper()
	s := &Systemd{UnitDir: t.TempDir()}
	return s.render(
		Spec{
			Key:     "demo/production",
			Dir:     "/opt/bay/data/apps/demo/production/current",
			Runtime: "/opt/bay/runtimes/node/bin/node",
			Entry:   "index.js",
			LogFile: "/opt/bay/data/apps/demo/production/logs/app.log",
		},
		Sandbox{
			Instance:      "/opt/bay/data/apps/demo/production",
			WritablePaths: []string{"/opt/bay/data/apps/demo/production/scratch"},
			MemoryMax:     "512M",
		},
		"bay-demo-production",
	)
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
	unit := renderUnit(t)

	if !strings.Contains(unit, "TimeoutStopSec=") {
		t.Fatal("without a cap, a wedged app holds its own rollback hostage for 90s")
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
