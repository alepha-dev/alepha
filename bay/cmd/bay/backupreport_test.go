package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/connector"
	"github.com/alepha-dev/bay/internal/state"
)

// withEvents gives a fixture an event spool and a bucket watcher, as serve does.
func withEvents(t *testing.T, f *deployFixture) *connector.EventSpool {
	t.Helper()
	f.server.events = connector.NewEventSpool(t.TempDir(), 0)
	f.server.targets = newTargetHealth()
	return f.server.events
}

func eventKinds(spool *connector.EventSpool) []string {
	var out []string
	for _, e := range spool.Pending() {
		out = append(out, e.Kind)
	}
	return out
}

func hasKind(spool *connector.EventSpool, kind string) bool {
	for _, k := range eventKinds(spool) {
		if k == kind {
			return true
		}
	}
	return false
}

// One event when the bucket goes down, one when it is back; a blip is only
// "degraded" and says nothing.
func TestTargetHealthTransitions(t *testing.T) {
	f := deployedApp(t)
	spool := withEvents(t, f)
	th := f.server.targets
	failing := true
	th.probeFn = func(context.Context) error {
		if failing {
			return errors.New("connection refused")
		}
		return nil
	}

	for i, want := range []string{"degraded", "degraded", "down", "down"} {
		if th.probe(context.Background(), f.server) {
			t.Fatalf("probe %d reported a refusing bucket as up", i)
		}
		if got := th.snapshot().Status; got != want {
			t.Fatalf("after %d failure(s) the status is %q, want %q", i+1, got, want)
		}
	}
	if got := eventKinds(spool); len(got) != 1 || got[0] != "target.down" {
		t.Fatalf("one target.down for one outage: %v", got)
	}
	if th.snapshot().LastError != "connection refused" || th.snapshot().Failures != 4 {
		t.Fatalf("the snapshot says why and how often: %+v", th.snapshot())
	}

	failing = false
	if !th.probe(context.Background(), f.server) || th.snapshot().Status != "ok" || th.snapshot().Failures != 0 {
		t.Fatalf("back up: %+v", th.snapshot())
	}
	if got := eventKinds(spool); len(got) != 2 || got[1] != "target.up" {
		t.Fatalf("target.up when it answers again: %v", got)
	}
}

func TestTargetHealthWithoutABucketIsUnconfiguredNotDown(t *testing.T) {
	f := deployedApp(t)
	withEvents(t, f)
	if !f.server.targets.probe(context.Background(), f.server) {
		t.Fatal("no bucket is not a bucket that is down")
	}
	if got := f.server.targets.snapshot().Status; got != "unconfigured" {
		t.Fatalf("status %q", got)
	}
}

func TestBackupAnomalies(t *testing.T) {
	prev := &state.BackupRecord{Databases: []state.DatabaseRecord{
		{Path: "app.db", RawBytes: 1 << 20, TopTables: []state.TableCount{{Table: "users", Rows: 40}, {Table: "jobs", Rows: 3}}},
		{Path: "queue/jobs.db", RawBytes: 4096},
	}}
	cur := state.BackupRecord{Databases: []state.DatabaseRecord{
		{Path: "app.db", RawBytes: 100 << 10, Integrity: "row 3 missing from index",
			TopTables: []state.TableCount{{Table: "users", Rows: 0}, {Table: "jobs", Rows: 1}}},
	}}
	got := strings.Join(backupAnomalies(prev, cur), "\n")
	for _, want := range []string{"queue/jobs.db is gone", "app.db shrank", "table users of app.db is now empty", "integrity: row 3"} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in:\n%s", want, got)
		}
	}
	if strings.Contains(got, "jobs of app.db") {
		t.Fatal("a table that only got smaller is not an anomaly")
	}
	if backupAnomalies(nil, cur) != nil {
		t.Fatal("a first backup has nothing to compare with")
	}
}

/*
A backup leaves the full report on the instance, refreshes the catalog and
tells Lore; the inventory block then reads "ok" from it without an S3 call.
*/
func TestBackupIsRecordedReportedAndInventoried(t *testing.T) {
	f, _, _ := bundleFixture(t)
	f.server.backupInterval = 6 * time.Hour
	spool := withEvents(t, f)

	if rec := f.backup(t); rec.Code != http.StatusOK {
		t.Fatalf("backup: %d %s", rec.Code, rec.Body)
	}
	app := f.app(t)
	if app.LastBackup == nil || app.LastBackup.Key != app.LastBackupKey || len(app.LastBackup.Databases) != 2 {
		t.Fatalf("the record names the backup and its databases: %+v", app.LastBackup)
	}
	if app.BackupCatalog == nil || app.BackupCatalog.Count != 1 {
		t.Fatalf("the catalog is refreshed after a backup: %+v", app.BackupCatalog)
	}
	if !hasKind(spool, "backup.completed") {
		t.Fatalf("events: %v", eventKinds(spool))
	}
	if got := f.server.targets.snapshot().Status; got != "ok" {
		t.Fatalf("a backup that reached the bucket says so: %q", got)
	}

	listed := f.server.listApps()
	var demo listedApp
	for _, a := range listed {
		if a.Key() == "demo/production" {
			demo = a
		}
	}
	now := time.Now()
	b := inventoryBackup(demo, computeStatus(demo, now, f.server.backupInterval), f.server.targets.snapshot(), true, now)
	if b == nil || b.State != "ok" || b.Last == nil || b.Last.Key != app.LastBackupKey || b.Catalog == nil || b.Policy == nil {
		raw, _ := json.Marshal(b)
		t.Fatalf("inventory block: %s", raw)
	}
	if b.Target == nil || b.Target.Status != "ok" || b.NextAt == "" {
		t.Fatalf("target and next run: %+v %q", b.Target, b.NextAt)
	}
	if inventoryBackup(demo, statusLine{}, targetStatus{}, false, now).State != "unconfigured" {
		t.Fatal("no bucket reads as unconfigured before anything else")
	}
	static := demo
	static.Static = true
	if inventoryBackup(static, statusLine{}, targetStatus{}, true, now) != nil {
		t.Fatal("no block for an instance without a database Bay owns")
	}
}

func TestInventoryBackupStateOrder(t *testing.T) {
	base := listedApp{App: state.App{Name: "demo", Env: "production", Backups: true}}
	now := time.Now()
	cases := []struct {
		name string
		mod  func(*listedApp, *statusLine)
		want string
	}{
		{"never", func(*listedApp, *statusLine) {}, "never"},
		{"ok", func(a *listedApp, _ *statusLine) { a.LastBackupAt = now.Format(time.RFC3339) }, "ok"},
		{"stale", func(a *listedApp, l *statusLine) { a.LastBackupAt = "2020-01-01T00:00:00Z"; l.BackupStale = true }, "stale"},
		{"failing", func(a *listedApp, _ *statusLine) {
			a.LastBackupAt = now.Format(time.RFC3339)
			a.BackupFailure = &state.BackupFailure{Message: "x", Consecutive: 2}
		}, "failing"},
		{"restore-pending", func(a *listedApp, _ *statusLine) {
			a.BackupFailure = &state.BackupFailure{Message: "x"}
			a.RestorePending = &state.RestorePending{Since: "2026-01-01T00:00:00Z"}
		}, "restore-pending"},
	}
	for _, c := range cases {
		a, line := base, statusLine{}
		c.mod(&a, &line)
		if got := inventoryBackup(a, line, targetStatus{Status: "ok"}, true, now).State; got != c.want {
			t.Errorf("%s: state %q, want %q", c.name, got, c.want)
		}
	}
}

// A restore and a deploy of one instance never interleave.
func TestRestoreIsRefusedWhileTheInstanceIsBusy(t *testing.T) {
	f, _, _ := bundleFixture(t)
	if rec := f.backup(t); rec.Code != http.StatusOK {
		t.Fatalf("backup: %d %s", rec.Code, rec.Body)
	}
	if _, ok := f.server.claimInstance("demo/production", "deploy"); !ok {
		t.Fatal("claim")
	}
	_, err := f.server.restoreInstance(context.Background(), f.app(t), nil, restoreOptions{Reason: "test", Trigger: "cli"})
	var re restoreError
	if !errors.As(err, &re) || re.status != http.StatusConflict || !strings.Contains(re.msg, "deploy") {
		t.Fatalf("want a 409 naming the deploy: %v", err)
	}
	f.server.releaseInstance("demo/production")
	if _, err := f.server.restoreInstance(context.Background(), f.app(t), nil, restoreOptions{Reason: "test", Trigger: "cli"}); err != nil {
		t.Fatalf("once released the restore runs: %v", err)
	}
	if r := f.app(t).LastRestore; r == nil || r.Status != "done" || r.Reason != "test" || r.PreRestoreKey == "" {
		t.Fatalf("the restore is recorded: %+v", r)
	}
}

// The app a restore stopped is the restore's to start again: a start, stop or
// restart in between would boot it on a data directory being swapped.
func TestStartStopAndRestartWaitForARestore(t *testing.T) {
	f, _, _ := bundleFixture(t)
	if _, ok := f.server.claimInstance("demo/production", "restore"); !ok {
		t.Fatal("claim")
	}
	for name, run := range map[string]func() error{
		"start":   func() error { return f.server.startInstance("demo/production") },
		"stop":    func() error { return f.server.stopInstance("demo/production") },
		"restart": func() error { return f.server.restart(f.app(t)) },
	} {
		if err := run(); err == nil || !strings.Contains(err.Error(), "being restored") {
			t.Errorf("%s during a restore: want a refusal, got %v", name, err)
		}
	}
	f.server.releaseInstance("demo/production")
	if err := f.server.startInstance("demo/production"); err != nil {
		t.Fatalf("once the restore is done, a start runs: %v", err)
	}

	// A deploy's claim is not a restore's: the deploy path restarts the app itself.
	if _, ok := f.server.claimInstance("demo/production", "deploy"); !ok {
		t.Fatal("claim")
	}
	defer f.server.releaseInstance("demo/production")
	if err := f.server.notRestoring("demo/production"); err != nil {
		t.Fatalf("a deploy is not a restore: %v", err)
	}
}
