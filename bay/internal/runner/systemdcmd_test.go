package runner

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

/*
No build tag, on purpose.

These assert the argv Bay issues for a unit's whole lifecycle, and they must run
where the code is written as well as where it ships. The functions under test
live outside systemd.go for exactly that reason: that file is
`//go:build linux`, the CI container has no `systemctl` binary, and between the
two there was no machine anywhere on which a test could have noticed that
`systemctl enable` was never called.
*/

// recorder is a commandRunner that remembers what it was asked to run and
// answers however the test needs.
type recorder struct {
	calls  []string
	answer func(name string, args ...string) ([]byte, error)
}

func (r *recorder) run(name string, args ...string) ([]byte, error) {
	r.calls = append(r.calls, strings.Join(append([]string{name}, args...), " "))
	if r.answer != nil {
		return r.answer(name, args...)
	}
	return nil, nil
}

func (r *recorder) ran(want string) bool {
	for _, c := range r.calls {
		if c == want {
			return true
		}
	}
	return false
}

/*
The reboot bug, as close as a test can get without a systemd host.

An app that is started but never enabled serves fine until the machine reboots
and then is simply gone, which is the one failure a deploy cannot reveal.
*/
func TestEnableUnitEnablesForTheNextBoot(t *testing.T) {
	rec := &recorder{}

	if err := enableUnit(rec.run, "bay-demo-production"); err != nil {
		t.Fatalf("enableUnit: %v", err)
	}

	if !rec.ran("systemctl enable bay-demo-production.service") {
		t.Errorf("did not enable the unit; ran %v", rec.calls)
	}
}

/*
`enable --now` is the obvious fix and the wrong one: it issues a plain `start`,
which does nothing to an already-active unit, so every redeploy after the first
would have gone on serving the old release. `Start` runs `restart` separately
and that is what has to keep doing the starting.
*/
func TestEnableUnitDoesNotStart(t *testing.T) {
	rec := &recorder{}

	if err := enableUnit(rec.run, "bay-demo-production"); err != nil {
		t.Fatalf("enableUnit: %v", err)
	}

	for _, c := range rec.calls {
		if strings.Contains(c, "--now") || strings.Contains(c, " start ") {
			t.Errorf("enableUnit must not start the unit, ran %q", c)
		}
	}
}

func TestEnableUnitReportsFailure(t *testing.T) {
	rec := &recorder{answer: func(string, ...string) ([]byte, error) {
		return []byte("Failed to enable unit"), errors.New("exit status 1")
	}}

	err := enableUnit(rec.run, "bay-demo-production")
	if err == nil {
		t.Fatal("expected an error")
	}
	// The operator needs systemctl's own words; "enable failed" alone sends
	// them to the wrong place.
	if !strings.Contains(err.Error(), "Failed to enable unit") {
		t.Errorf("error drops systemctl's message: %v", err)
	}
}

func TestRemoveUnitUninstallsCompletely(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bay-demo-production.service")
	if err := os.WriteFile(path, []byte("[Unit]\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	rec := &recorder{}

	if err := removeUnit(rec.run, dir, "bay-demo-production"); err != nil {
		t.Fatalf("removeUnit: %v", err)
	}

	// `--now` here, unlike enable: nothing restarts afterwards, so the app has
	// to actually stop.
	if !rec.ran("systemctl disable --now bay-demo-production.service") {
		t.Errorf("did not disable the unit; ran %v", rec.calls)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("unit file %s survived removal", path)
	}
	if !rec.ran("systemctl daemon-reload") {
		t.Errorf("did not reload systemd; ran %v", rec.calls)
	}
	if !rec.ran("systemctl reset-failed bay-demo-production.service") {
		t.Errorf("did not clear the failed state; ran %v", rec.calls)
	}
}

/*
The file must go even when systemctl refuses, because the file is what brings
the app back at the next reboot. Stopping at the first error would leave an
enabled unit for an app Bay has forgotten — the same reboot bug, pointing the
other way.
*/
func TestRemoveUnitDeletesTheFileEvenWhenDisableFails(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bay-demo-production.service")
	if err := os.WriteFile(path, []byte("[Unit]\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	rec := &recorder{answer: func(_ string, args ...string) ([]byte, error) {
		if len(args) > 0 && args[0] == "disable" {
			return []byte("Access denied"), errors.New("exit status 1")
		}
		return nil, nil
	}}

	err := removeUnit(rec.run, dir, "bay-demo-production")

	if err == nil {
		t.Error("a failed disable must still be reported")
	}
	if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
		t.Errorf("unit file %s survived a failed disable", path)
	}
	if !rec.ran("systemctl daemon-reload") {
		t.Errorf("gave up before reloading systemd; ran %v", rec.calls)
	}
}

/*
`handleRemove` stops the app before uninstalling it, and the very first deploy
has nothing to stop at all, so "no such unit" is the ordinary case rather than a
fault.
*/
func TestRemoveUnitToleratesAnAbsentUnit(t *testing.T) {
	rec := &recorder{answer: func(_ string, args ...string) ([]byte, error) {
		if len(args) > 0 && args[0] == "disable" {
			return []byte("Failed to disable unit: Unit file bay-gone.service does not exist."), errors.New("exit status 1")
		}
		return nil, nil
	}}

	// The temp dir holds no unit file either, so the os.Remove is a miss too.
	if err := removeUnit(rec.run, t.TempDir(), "bay-gone"); err != nil {
		t.Errorf("removing an app that never started is not a failure: %v", err)
	}
}

func TestDeleteUserRemovesTheAccount(t *testing.T) {
	rec := &recorder{}

	if err := deleteUser(rec.run, "bay-demo-production"); err != nil {
		t.Fatalf("deleteUser: %v", err)
	}

	if !rec.ran("userdel bay-demo-production") {
		t.Errorf("did not delete the user; ran %v", rec.calls)
	}
	// EnsureUser creates these with --no-create-home and the instance directory
	// belongs to Bay, so there is no home to take and --remove-home would be
	// reaching outside what Bay made.
	for _, c := range rec.calls {
		if strings.Contains(c, "--remove-home") || strings.Contains(c, "-r ") {
			t.Errorf("deleteUser must not remove a home directory, ran %q", c)
		}
	}
}

/*
An app that only ever ran under the child runner has no unix user, and neither
does one whose useradd failed. Nothing to delete is success.
*/
func TestDeleteUserIsQuietWhenThereIsNoUser(t *testing.T) {
	rec := &recorder{answer: func(name string, _ ...string) ([]byte, error) {
		if name == "id" {
			return []byte("no such user"), errors.New("exit status 1")
		}
		return nil, nil
	}}

	if err := deleteUser(rec.run, "bay-never-existed"); err != nil {
		t.Fatalf("deleteUser: %v", err)
	}

	if rec.ran("userdel bay-never-existed") {
		t.Error("ran userdel for a user that does not exist")
	}
}
