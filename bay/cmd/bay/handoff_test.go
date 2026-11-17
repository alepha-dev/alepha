package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestFreeze(t *testing.T) {
	t.Run("a handoff is refused while work runs, and names it", func(t *testing.T) {
		f := newDeployFixture(t)
		done, err := f.server.beginWork("a scheduled backup of demo/production")
		if err != nil {
			t.Fatal(err)
		}
		err = f.server.freeze()
		if err == nil || !strings.Contains(err.Error(), "a scheduled backup of demo/production") {
			t.Fatalf("err = %v", err)
		}
		if f.server.isFrozen() {
			t.Fatal("a refused freeze must leave Bay unfrozen")
		}
		done()
		done() // twice is safe
		if err := f.server.freeze(); err != nil {
			t.Fatalf("with nothing running: %v", err)
		}
	})

	t.Run("an instance a deploy or a restore holds refuses it too", func(t *testing.T) {
		f := newDeployFixture(t)
		if _, ok := f.server.claimInstance("demo/production", "restore"); !ok {
			t.Fatal("claim")
		}
		err := f.server.freeze()
		if err == nil || !strings.Contains(err.Error(), "a restore of demo/production") {
			t.Fatalf("err = %v", err)
		}
		f.server.releaseInstance("demo/production")
		if err := f.server.freeze(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("so does a Bay still starting its apps", func(t *testing.T) {
		f := newDeployFixture(t)
		f.server.booting.Store(true)
		if err := f.server.freeze(); err == nil || !strings.Contains(err.Error(), "the start of this Bay's apps") {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("frozen, nothing starts and a second handoff is refused", func(t *testing.T) {
		f := newDeployFixture(t)
		if err := f.server.freeze(); err != nil {
			t.Fatal(err)
		}
		if _, err := f.server.beginWork("anything"); err == nil || err.Error() != handingOver {
			t.Fatalf("err = %v", err)
		}
		if err := f.server.freeze(); err == nil || !strings.Contains(err.Error(), "already running") {
			t.Fatalf("err = %v", err)
		}
		f.server.unfreeze()
		if _, err := f.server.beginWork("anything"); err != nil {
			t.Fatalf("after the unfreeze: %v", err)
		}
	})
}

func TestHandOver(t *testing.T) {
	t.Run("a Bay that is not serving cannot hand over", func(t *testing.T) {
		f := newDeployFixture(t)
		if err := f.server.handOver(); err == nil {
			t.Fatal("expected a refusal")
		}
	})

	t.Run("the freeze holds for the whole handoff, and stays once the successor is ready", func(t *testing.T) {
		f := newDeployFixture(t)
		frozenDuring := false
		f.server.upgrade = func() error {
			_, err := f.server.beginWork("a deploy")
			frozenDuring = err != nil
			return nil
		}
		if err := f.server.handOver(); err != nil {
			t.Fatal(err)
		}
		if !frozenDuring || !f.server.isFrozen() {
			t.Fatalf("frozen during = %v, after = %v", frozenDuring, f.server.isFrozen())
		}
	})

	t.Run("a successor that does not take over leaves this Bay unfrozen, with its reason", func(t *testing.T) {
		f := newDeployFixture(t)
		f.server.upgrade = func() error {
			leaveHandoffError(f.root, errors.New("state.json: unexpected end of JSON input"))
			return withHandoffError(f.root, errors.New("child pid=42 exited: exit status 1"))
		}
		err := f.server.handOver()
		if err == nil || !strings.Contains(err.Error(), "exit status 1") || !strings.Contains(err.Error(), "unexpected end of JSON input") {
			t.Fatalf("err = %v", err)
		}
		if f.server.isFrozen() {
			t.Fatal("still frozen after a failed handoff")
		}
		if _, statErr := os.Stat(handoffErrorFile(f.root)); statErr == nil {
			t.Fatal("the reason file must not outlive the handoff it explains")
		}
	})

	t.Run("refused while work runs: the successor is never started", func(t *testing.T) {
		f := newDeployFixture(t)
		started := false
		f.server.upgrade = func() error { started = true; return nil }
		done, _ := f.server.beginWork("a control request (POST /apps)")
		defer done()
		if err := f.server.handOver(); err == nil || started {
			t.Fatalf("err = %v, started = %v", err, started)
		}
	})
}

func TestTheControlSocketDuringAHandoff(t *testing.T) {
	f := newDeployFixture(t)
	calls := 0
	guarded := f.server.guardControl(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method == http.MethodPost {
			// A write in flight is work a handoff must not start under.
			if err := f.server.freeze(); err == nil || !strings.Contains(err.Error(), "POST /apps") {
				t.Errorf("freeze during a write: %v", err)
			}
		}
		w.WriteHeader(http.StatusOK)
	}))
	do := func(method string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		guarded.ServeHTTP(rec, httptest.NewRequest(method, "/apps", nil))
		return rec
	}
	if rec := do(http.MethodPost); rec.Code != http.StatusOK {
		t.Fatalf("a write outside a handoff: %d", rec.Code)
	}
	if err := f.server.freeze(); err != nil {
		t.Fatal(err)
	}
	rec := do(http.MethodPost)
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), handingOver) {
		t.Fatalf("a write during a handoff: %d %s", rec.Code, rec.Body)
	}
	if rec := do(http.MethodGet); rec.Code != http.StatusOK {
		t.Fatalf("a read during a handoff must answer: %d", rec.Code)
	}
	if calls != 2 {
		t.Fatalf("the refused write reached the API: %d calls", calls)
	}
}

func TestACommandFromLoreDuringAHandoff(t *testing.T) {
	f := deployedApp(t)
	acts := newActions(f.server)
	if err := f.server.freeze(); err != nil {
		t.Fatal(err)
	}
	rec := &ackRecorder{}
	acts.Command(context.Background(), stopCommand("c-frozen"), rec.send)
	last := rec.acks[len(rec.acks)-1]
	if last.Status != "failed" || last.Reason != handingOver {
		t.Fatalf("ack = %+v", last)
	}
	if app, _ := f.server.store.Get("demo/production"); app.Stopped {
		t.Fatal("a command refused during a handoff must not have run")
	}

	// And a command that is running refuses the handoff.
	f.server.unfreeze()
	done, _ := f.server.beginWork("the deploy command from Lore")
	if err := f.server.freeze(); err == nil || !strings.Contains(err.Error(), "the deploy command from Lore") {
		t.Fatalf("err = %v", err)
	}
	done()
}

func TestUpgradeModeDetection(t *testing.T) {
	t.Run("the unit is read from the process's own cgroup", func(t *testing.T) {
		for cgroup, want := range map[string]string{
			"0::/system.slice/bay.service\n":                   "bay.service",
			"0::/system.slice/bay-staging.service\n":           "bay-staging.service",
			"0::/user.slice/user-1000.slice/session-3.scope\n": "",
			"0::/\n":            "",
			"0::/docker/3f1c\n": "",
			"12:pids:/system.slice/bay.service\n0::/system.slice\n": "",
			"": "",
			"0::/system.slice/system-bay.slice/bay@blue.service\n": "bay@blue.service",
		} {
			if got := unitOfCgroup(cgroup); got != want {
				t.Errorf("unitOfCgroup(%q) = %q, want %q", cgroup, got, want)
			}
		}
	})

	t.Run("the drop-in is in effect only with Bay's own PID file and a SIGHUP reload", func(t *testing.T) {
		const reload = "ExecReload={ path=/bin/kill ; argv[]=/bin/kill -HUP $MAINPID ; ignore_errors=no ; start_time=[n/a] }"
		cases := []struct {
			name, show, pidFile string
			want                bool
		}{
			{"both", "PIDFile=/run/bay/bay.pid\n" + reload + "\n", "/run/bay/bay.pid", true},
			{"no drop-in", "PIDFile=\n", "/run/bay/bay.pid", false},
			{"a PID file Bay does not write", "PIDFile=/run/other.pid\n" + reload + "\n", "/run/bay/bay.pid", false},
			{"no reload", "PIDFile=/run/bay/bay.pid\n", "/run/bay/bay.pid", false},
			{"a reload that is not a SIGHUP", "PIDFile=/run/bay/bay.pid\nExecReload={ path=/bin/true ; argv[]=/bin/true }\n", "/run/bay/bay.pid", false},
			{"no runtime directory, so no PID file written", "PIDFile=/run/bay/bay.pid\n" + reload + "\n", "", false},
		}
		for _, tc := range cases {
			if got := dropInInEffect(tc.show, tc.pidFile); got != tc.want {
				t.Errorf("%s: %v, want %v", tc.name, got, tc.want)
			}
		}
	})

	t.Run("a unit is Bay's only when its main process is this one, or the one it takes over from", func(t *testing.T) {
		const dropIn = "PIDFile=/run/bay/bay.pid\nExecReload={ path=/bin/kill ; argv[]=/bin/kill -HUP $MAINPID }\n"
		cases := []struct {
			name, show string
			pids       []int
			want       string
		}{
			{"the unit's main process, with the drop-in", dropIn + "MainPID=145\n", []int{145}, upgradeHandoff},
			{"the unit's main process, without it", "PIDFile=\nMainPID=145\n", []int{145}, upgradeRestart},
			{"a successor, while systemd still names its parent", dropIn + "MainPID=145\n", []int{306, 145}, upgradeHandoff},
			{"started by hand inside another service's cgroup (a CI runner)", "PIDFile=\nMainPID=812\n", []int{4242}, upgradeManual},
			{"the same, under a unit that happens to have the drop-in", dropIn + "MainPID=812\n", []int{4242}, upgradeManual},
			{"a unit with no main process", dropIn + "MainPID=0\n", []int{4242}, upgradeManual},
			{"an answer with no MainPID at all", dropIn, []int{4242}, upgradeManual},
		}
		for _, tc := range cases {
			if got := upgradeModeOf(tc.show, "/run/bay/bay.pid", tc.pids...); got != tc.want {
				t.Errorf("%s: %q, want %q", tc.name, got, tc.want)
			}
		}
	})

	t.Run("the PID file lives in the unit's runtime directory, and nowhere outside systemd", func(t *testing.T) {
		t.Setenv("RUNTIME_DIRECTORY", "/run/bay")
		if got := pidFilePath(); got != filepath.Join("/run/bay", "bay.pid") {
			t.Fatalf("pid file = %q", got)
		}
		t.Setenv("RUNTIME_DIRECTORY", "/run/bay:/run/other")
		if got := pidFilePath(); got != filepath.Join("/run/bay", "bay.pid") {
			t.Fatalf("with two runtime directories: %q", got)
		}
		t.Setenv("RUNTIME_DIRECTORY", "")
		if got := pidFilePath(); got != "" {
			t.Fatalf("outside systemd: %q", got)
		}
	})
}

func TestDoctorHandoffCheck(t *testing.T) {
	known := unitExists
	t.Cleanup(func() { unitExists = known })
	const dropIn = "PIDFile=/run/bay/bay.pid\nExecReload={ path=/bin/kill ; argv[]=/bin/kill -HUP $MAINPID }\n"

	unitExists = func() bool { return false }
	if _, has := handoffCheck(dropIn, nil); has {
		t.Fatal("a host with no bay unit has nothing to check")
	}
	unitExists = func() bool { return true }
	if _, has := handoffCheck("", errors.New("systemctl: not found")); has {
		t.Fatal("a host without systemd has nothing to check")
	}
	c, has := handoffCheck(dropIn, nil)
	if !has || !c.OK {
		t.Fatalf("with the drop-in: %+v", c)
	}
	c, has = handoffCheck("PIDFile=\n", nil)
	if !has || c.OK || !c.Warn || !strings.Contains(c.Detail, "BAY_UPDATE_UNIT=yes") {
		t.Fatalf("without the drop-in: %+v", c)
	}
}

// A scheduled backup started while the successor boots would write state the
// successor never read: the scheduler skips its turn instead.
func TestTheBackupSchedulerIsPausedDuringAHandoff(t *testing.T) {
	f, _, _ := bundleFixture(t)
	f.server.backupInterval = time.Hour
	if err := f.server.freeze(); err != nil {
		t.Fatal(err)
	}
	f.server.runDueBackups(context.Background())
	if at := f.app(t).LastBackupAt; at != "" {
		t.Fatalf("a backup ran during the handoff: %s", at)
	}
	if len(f.server.backupRetries) != 0 {
		t.Fatalf("a paused run is not a failed one: %+v", f.server.backupRetries)
	}
	f.server.unfreeze()
	f.server.runDueBackups(context.Background())
	if f.app(t).LastBackupAt == "" {
		t.Fatal("the run was not taken once the handoff was over")
	}
}
