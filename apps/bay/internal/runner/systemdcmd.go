package runner

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

/*
The external commands Bay runs to install and uninstall a unit, split out of
systemd.go so they can be tested anywhere.

systemd.go is `//go:build linux`, and the CI container has no systemd and no
`systemctl` binary — so the lifecycle calls in it were, between the build tag
and the missing daemon, reachable by no test on any machine the project runs.
That is how `systemctl enable` came to be missing for as long as it was: the
unit rendered a correct `[Install]` section, `restart` started it, everything
looked right, and nothing anywhere asserted that an app would still be there
after a reboot.

`run` is the seam. It is the only thing here that touches the outside world, so
a test can hand these functions a recorder and assert the exact argv Bay would
have issued, in order, on any host. Injected as a parameter rather than kept in
a package variable: a global that tests swap is the shape that leaks between
them.
*/
type commandRunner func(name string, args ...string) ([]byte, error)

/*
enableUnit makes the unit survive a reboot.

Deliberately `enable` and NOT `enable --now`, which the obvious reading of the
bug would suggest. `Start` already runs `reset-failed` then `restart` right
after this, and that pair is load-bearing: `restart` replaces a RUNNING
instance, which is what every deploy after the first one is doing, while
`--now` issues a plain `start` that does nothing at all to an already-active
unit. Taking the shortcut would have made the first deploy work and every
redeploy silently serve the old release.

`enable` writes a symlink into multi-user.target.wants and nothing else, so
running it on every deploy is idempotent.
*/
func enableUnit(run commandRunner, unit string) error {
	if out, err := run("systemctl", "enable", unit+".service"); err != nil {
		return fmt.Errorf("enable %s: %w: %s", unit, err, strings.TrimSpace(string(out)))
	}
	return nil
}

/*
removeUnit uninstalls a unit: stopped, un-enabled, file gone, systemd told.

Every step's error is collected rather than returned at the first one. This runs
while an app is being unregistered, and stopping halfway is the worst outcome
available: a unit file left on disk with its `[Install]` symlink still in place
is an app that comes back at the next reboot after Bay has forgotten it exists,
which is the reboot bug this whole change is about, pointing the other way.

`disable --now` rather than `disable`, here: there is no restart to follow, and
the app must actually stop.

A unit that is not loaded is not a failure — `handleRemove` calls `Stop` first,
and an app that never started has nothing to disable.
*/
func removeUnit(run commandRunner, unitDir, unit string) error {
	var problems []string

	if out, err := run("systemctl", "disable", "--now", unit+".service"); err != nil {
		text := strings.TrimSpace(string(out))
		if !notLoaded(text) {
			problems = append(problems, fmt.Sprintf("disable: %v: %s", err, text))
		}
	}

	path := filepath.Join(unitDir, unit+".service")
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		problems = append(problems, fmt.Sprintf("remove %s: %v", path, err))
	}

	// After the file is gone, so systemd forgets the unit rather than
	// remembering a file that no longer exists.
	if out, err := run("systemctl", "daemon-reload"); err != nil {
		problems = append(problems, fmt.Sprintf("daemon-reload: %v: %s", err, strings.TrimSpace(string(out))))
	}

	// A unit removed while `failed` keeps its failed state in systemd's memory,
	// where it shows up in `systemctl --failed` forever and makes an operator
	// hunt for an app that no longer exists. Ignored: nothing to reset is the
	// normal case, exactly as in Start.
	_, _ = run("systemctl", "reset-failed", unit+".service")

	if len(problems) > 0 {
		return fmt.Errorf("remove unit %s: %s", unit, strings.Join(problems, "; "))
	}
	return nil
}

/*
deleteUser removes an app's dedicated unix user.

⚠️ Called ONLY when the app's data is being purged, which is narrower than the
bug report asked for. Removing the user while its files stay on disk is not the
tidy-up it looks like: those files — the database, and a 0600 `.env` full of the
app's secrets — are left owned by a bare numeric uid, and `useradd --system`
reuses freed uids. The next app provisioned on that host can be handed the uid
that still owns the previous app's secrets, and nothing anywhere would say so.

So the choice is between a leftover user with no files it can reach on a host
that keeps the data, and a leftover uid that a future account can inherit. The
first is untidy; the second is the per-instance-user isolation quietly failing.

Without `--purge` the user is therefore kept, which also makes remove followed
by redeploy a no-op for ownership.

No `--remove-home`: `EnsureUser` creates these with `--no-create-home`, and the
instance directory belongs to Bay, not to the user.
*/
func deleteUser(run commandRunner, user string) error {
	// Deleting a user that is not there is success, not an error: an app that
	// only ever ran under the child runner has no unix user at all.
	if _, err := run("id", "-u", user); err != nil {
		return nil
	}
	if out, err := run("userdel", user); err != nil {
		return fmt.Errorf("delete user %s: %w: %s", user, err, strings.TrimSpace(string(out)))
	}
	return nil
}

/*
notLoaded reports whether systemctl's complaint is just that there is no such
unit.

Matched on the message because systemctl answers all of these with exit code 1
and no more specific status.

Three phrases, not the two `Stop` matches. `disable` does not say "not loaded" -
it says `Failed to disable unit: Unit file bay-x.service does not exist.` - so
matching only Stop's pair turned removing an app that had never started into a
reported failure. Found by the test below, which is the entire reason these
helpers were pulled out of the systemd-only file.
*/
func notLoaded(text string) bool {
	return strings.Contains(text, "not loaded") ||
		strings.Contains(text, "not found") ||
		strings.Contains(text, "does not exist")
}

/*
parkUnit takes a unit out of service and keeps it out across a reboot.

`disable --now` is one call that stops the unit AND removes its
multi-user.target.wants symlink, so the app does not come back at the next
boot. The same argv `removeUnit` issues, for the same reason.

It lives here rather than beside `Systemd.Park` on the same grounds as its two
neighbours: systemd.go is `//go:build linux`, so an argv written there is
asserted by no test on any machine this project builds on, and a park that
quietly ran `stop` instead would look identical until the host rebooted.

A unit that is not loaded is not a failure. Parking something already gone is
the outcome the caller asked for, and `handleRemove` is not the only path that
reaches a unit systemd has never heard of.
*/
func parkUnit(run commandRunner, unit string) error {
	out, err := run("systemctl", "disable", "--now", unit+".service")
	if err == nil {
		return nil
	}
	text := strings.TrimSpace(string(out))
	if notLoaded(text) {
		return nil
	}
	return fmt.Errorf("disable: %w: %s", err, text)
}
