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
