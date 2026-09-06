package main

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/alepha/bay/internal/connector"
	"github.com/alepha/bay/internal/state"
)

func backupCommand(id, app string) connector.Command {
	return connector.Command{ID: id, Kind: "backup", App: app, Environment: "production"}
}

/*
The gate the manual path was missing.

`runDueBackups` skipped an app whose manifest declared no database;
`handleBackup` did not, so `bay backup` on a BYO-database app recorded a
failure only a success could clear - the exact trap `state.App.Backups`'
comment describes. The refusal must therefore leave `LastBackupError` alone.
*/
func TestBackupRefusesAnAppWithNoDatabaseAndRecordsNoFailure(t *testing.T) {
	f := deployedApp(t)
	if err := f.server.store.Upsert(state.App{
		Name: "byo", Env: "production", Release: "r1", Backups: false,
	}); err != nil {
		t.Fatal(err)
	}

	_, err := f.server.backupInstance(context.Background(), mustGet(t, f, "byo/production"))
	if err == nil {
		t.Fatal("an app with no database Bay owns must be refused")
	}
	var refused backupRefused
	if !asRefusal(err, &refused) {
		t.Fatalf("the refusal must be typed, not a generic failure: %v", err)
	}
	if !strings.Contains(err.Error(), "no database") {
		t.Fatalf("the reason must say why: %q", err.Error())
	}

	app := mustGet(t, f, "byo/production")
	if app.LastBackupError != "" {
		t.Fatalf("a refusal must not record a failure: %q", app.LastBackupError)
	}
	if app.LastBackupAt != "" {
		t.Fatal("a refusal must not record a success either")
	}
}

func TestBackupRefusesAStaticSite(t *testing.T) {
	f := deployedApp(t)
	if err := f.server.store.Upsert(state.App{
		Name: "site", Env: "production", Release: "r1", Static: true, Backups: true,
	}); err != nil {
		t.Fatal(err)
	}

	_, err := f.server.backupInstance(context.Background(), mustGet(t, f, "site/production"))
	var refused backupRefused
	if err == nil || !asRefusal(err, &refused) {
		t.Fatalf("a static site must be refused: %v", err)
	}
	if mustGet(t, f, "site/production").LastBackupError != "" {
		t.Fatal("a refusal must not record a failure")
	}
}

// The verb reports the refusal rather than pretending a backup happened.
func TestBackupActionReportsTheRefusal(t *testing.T) {
	f := deployedApp(t)
	acts := newActions(f.server)
	rec := &ackRecorder{}

	acts.Command(context.Background(), backupCommand("c-backup", "demo"), rec.send)

	last := rec.acks[len(rec.acks)-1]
	if last.Status != "failed" {
		t.Fatalf("no bucket is configured in the fixture, so this must fail: %+v", last)
	}
	if last.Reason == "" {
		t.Fatal("the ack must say why")
	}
}

/*
A backup must not take the machine-wide action mutex.

A snapshot plus an upload is minutes; holding that lock would queue an
unrelated app's restart behind it. Asserted by holding the mutex here and
requiring the command to finish anyway.
*/
func TestBackupRunsOutsideTheMachineWideMutex(t *testing.T) {
	f := deployedApp(t)
	acts := newActions(f.server)
	rec := &ackRecorder{}

	acts.mu.Lock()
	defer acts.mu.Unlock()

	done := make(chan struct{})
	go func() {
		acts.Command(context.Background(), backupCommand("c-backup", "demo"), rec.send)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("a backup queued behind the machine-wide action mutex")
	}
}

/*
The per-instance lock is shared, which is the point: a console-triggered
backup at 03:00:01 must not run VACUUM INTO against the database the nightly
run is already reading. Two different databases are not serialised.
*/
func TestBackupLockIsPerInstanceAndShared(t *testing.T) {
	f := deployedApp(t)

	release := f.server.lockBackup("demo/production")
	locked := make(chan struct{})
	go func() {
		f.server.lockBackup("demo/production")()
		close(locked)
	}()
	select {
	case <-locked:
		t.Fatal("two backups of one instance must not run at once")
	case <-time.After(100 * time.Millisecond):
	}
	release()
	select {
	case <-locked:
	case <-time.After(2 * time.Second):
		t.Fatal("the lock was never released")
	}

	// Another instance is free while the first is held.
	release = f.server.lockBackup("demo/production")
	other := make(chan struct{})
	go func() {
		f.server.lockBackup("other/production")()
		close(other)
	}()
	select {
	case <-other:
	case <-time.After(2 * time.Second):
		t.Fatal("two different databases must not serialise against each other")
	}
	release()
}

func mustGet(t *testing.T, f *deployFixture, key string) state.App {
	t.Helper()
	app, ok := f.server.store.Get(key)
	if !ok {
		t.Fatalf("fixture error: %s is not in the store", key)
	}
	return app
}

// asRefusal is `errors.As` without importing it into every assertion.
func asRefusal(err error, target *backupRefused) bool {
	refused, ok := err.(backupRefused)
	if ok {
		*target = refused
	}
	return ok
}

/*
The verb's own ack sequence, on a backup that actually succeeds.

The refusal above and the mutex test both end in `failed`, so neither says
anything about the happy path. `running` is what lets the console tell a
snapshot in progress from a machine that stopped answering, and this is the
one verb where the gap is measured in minutes rather than seconds: a backup
that only acked on completion would show as pending for the whole upload.

It also asserts the trace, because a `done` that recorded nothing is the
manual-backup bug in a different costume: the ack says success and
`bay status` still calls the backup stale.
*/
func TestBackupAcksRunningThenDoneAndRecordsTheSuccess(t *testing.T) {
	f := newBackupFixture(t)
	acts := newActions(f.server)
	rec := &ackRecorder{}

	acts.Command(context.Background(), backupCommand("c-backup-ok", "demo"), rec.send)

	if got := rec.statuses(); !equalStrings(got, []string{"running", "done"}) {
		t.Fatalf("acks = %v, want running then done", got)
	}
	app := mustGet(t, f, "demo/production")
	if app.LastBackupAt == "" {
		t.Fatal("a done backup must leave the trace bay status reads for staleness")
	}
	if app.LastBackupError != "" {
		t.Fatalf("a success must clear the failure, not sit beside it: %q", app.LastBackupError)
	}
}

/*
A redelivered backup is re-acked from the store, never taken twice.

Generic redelivery is proved on `restart`, which is cheap and idempotent.
This is the verb where running it twice actually costs something: a second
snapshot of the same database, a second upload, and a retention prune that
counts them both.
*/
func TestRedeliveredBackupIsNotTakenTwice(t *testing.T) {
	f := newBackupFixture(t)
	acts := newActions(f.server)

	acts.Command(context.Background(), backupCommand("c-backup-dup", "demo"), (&ackRecorder{}).send)
	first := mustGet(t, f, "demo/production").LastBackupAt
	if first == "" {
		t.Fatal("the first delivery must have taken a backup")
	}

	rec := &ackRecorder{}
	acts.Command(context.Background(), backupCommand("c-backup-dup", "demo"), rec.send)

	if got := rec.statuses(); !equalStrings(got, []string{"done"}) {
		t.Fatalf("acks = %v, want the stored outcome re-acked and nothing run", got)
	}
	if again := mustGet(t, f, "demo/production").LastBackupAt; again != first {
		t.Fatalf("a redelivered id took a second backup: %q -> %q", first, again)
	}
}
