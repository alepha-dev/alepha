package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alepha/bay/internal/schedule"
	"github.com/alepha/bay/internal/state"
)

// snapshotCapableNode stands in for the runtime Bay borrows to read SQLite.
//
// Bay ships no SQLite driver on purpose — it runs the app's OWN node so the
// same library that wrote the database reads it. That makes the real helper an
// integration dependency (a node binary, a real database, `node:sqlite`), which
// this test does not need: what is under test is whether a SUCCESSFUL backup is
// recorded, so the stand-in only has to succeed the way node does — copy the
// file and print the inspection on the last line of stdout.
func snapshotCapableNode(t *testing.T, path string) {
	t.Helper()
	script := `#!/bin/sh
# argv: <helper.js> <command> <src> <dest>
case "$2" in
  snapshot) cp "$3" "$4" || exit 1 ;;
  verify)   ;;
  *)        exit 2 ;;
esac
echo '{"integrity":"ok","tables":3}'
`
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
}

// fakeS3 accepts an upload and reports an empty bucket.
//
// Empty on purpose: retention runs right after the upload, and a listing with
// nothing in it means `Prune` finds nothing to delete — keeping this test about
// the one thing it is about.
func fakeS3(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/xml")
			_, _ = w.Write([]byte(
				`<?xml version="1.0" encoding="UTF-8"?>` +
					`<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>`))
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// backupFixture is a deployed app with somewhere to back up to.
func newBackupFixture(t *testing.T) *deployFixture {
	t.Helper()
	f := newDeployFixture(t)

	if _, failure := f.deploy(deployableArtifact(t)); failure != nil {
		t.Fatalf("the app has to be deployed before it can be backed up: %v", failure)
	}
	snapshotCapableNode(t, filepath.Join(f.root, "runtimes", "node-24", "bin", "node"))

	// The app declares a database Bay provisioned, which is what makes it
	// backup-able: `backupInstance` refuses an app on a BYO `DATABASE_URL`,
	// because there is nothing there Bay could snapshot. Set on the row rather
	// than in the manifest so the shared `deployableArtifact` keeps meaning
	// "an app with no resources" for every other test that reads it.
	if app, ok := f.server.store.Get("demo/production"); ok {
		app.Backups = true
		if err := f.server.store.Upsert(app); err != nil {
			t.Fatal(err)
		}
	}

	// The database the app would have written. Its contents are irrelevant — the
	// stand-in copies bytes rather than reading SQL.
	dataDir := filepath.Join(f.root, "apps", "demo", "production", "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "app.db"), []byte("SQLite format 3\x00"), 0o644); err != nil {
		t.Fatal(err)
	}

	srv := fakeS3(t)
	if err := f.server.store.SetS3(&state.S3Config{
		S3Target: state.S3Target{
			Endpoint:  srv.URL,
			Bucket:    "backups",
			AccessKey: "key",
			SecretKey: "secret",
			Region:    "auto",
		},
		Keep: 7,
	}); err != nil {
		t.Fatal(err)
	}
	return f
}

// backup runs the manual path — the one `bay backup` reaches through the
// control socket.
func (f *deployFixture) backup(t *testing.T) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/apps/demo/production/backup", nil)
	req.SetPathValue("name", "demo")
	req.SetPathValue("env", "production")
	rec := httptest.NewRecorder()
	f.server.handleBackup(rec, req)
	return rec
}

func (f *deployFixture) app(t *testing.T) state.App {
	t.Helper()
	app, ok := f.server.store.Get("demo/production")
	if !ok {
		t.Fatal("demo/production should be registered")
	}
	return app
}

// A manual backup must leave the same trace a scheduled one does.
//
// The bug this pins: only `backupOne` called `RecordBackupSuccess`, so a backup
// taken by hand uploaded fine and reported fine while the store still said the
// last one was whenever the scheduler last ran. `bay status` reads that field
// to decide staleness — so the command an operator runs deliberately BEFORE a
// risky change was the one that left `status` saying the backup was stale.
func TestManualBackupRecordsItsSuccess(t *testing.T) {
	f := newBackupFixture(t)

	if before := f.app(t).LastBackupAt; before != "" {
		t.Fatalf("nothing should be recorded before the first backup, got %q", before)
	}

	rec := f.backup(t)

	if rec.Code != http.StatusOK {
		t.Fatalf("backup should have succeeded, got %d: %s", rec.Code, rec.Body)
	}
	app := f.app(t)
	if app.LastBackupAt == "" {
		t.Error("a successful manual backup must advance LastBackupAt — `bay status` reads it to judge staleness")
	}
	if app.LastBackupKey == "" {
		t.Error("a successful manual backup must record the key it wrote")
	}
}

// The freshness `status` reports has to be the backup that just ran.
func TestManualBackupIsNotStaleImmediatelyAfterwards(t *testing.T) {
	f := newBackupFixture(t)
	f.backup(t)

	// The same question `bay status` asks, through the same helper.
	stale, _ := schedule.Stale(f.app(t).LastBackupAt, time.Now(), 24*time.Hour)

	if stale {
		t.Error("a backup taken a moment ago must not read as stale")
	}
}

// Success has to clear a previous failure, or `status` keeps warning about a
// problem the operator has already fixed.
func TestManualBackupClearsAnEarlierFailure(t *testing.T) {
	f := newBackupFixture(t)
	if err := f.server.store.RecordBackupFailure("demo/production", "upload: no route to host", time.Now()); err != nil {
		t.Fatal(err)
	}

	f.backup(t)

	if reason := f.app(t).LastBackupError; reason != "" {
		t.Errorf("a successful backup must clear the earlier failure, still saw %q", reason)
	}
}

// The mirror image, so the fix cannot be "record always".
//
// `LastBackupAt` means "last time we had a usable backup". A failed attempt
// that advanced it would silence the staleness warning precisely when the
// backups have stopped working — the one moment it has to be loud.
func TestFailedManualBackupDoesNotAdvanceLastBackupAt(t *testing.T) {
	f := newBackupFixture(t)

	// No database to snapshot: the failure lands in `mgr.Backup`, before upload.
	if err := os.Remove(filepath.Join(f.root, "apps", "demo", "production", "data", "app.db")); err != nil {
		t.Fatal(err)
	}

	rec := f.backup(t)

	if rec.Code == http.StatusOK {
		t.Fatalf("a backup with no database must fail, got %d", rec.Code)
	}
	if at := f.app(t).LastBackupAt; at != "" {
		t.Errorf("a failed backup must not claim freshness, got %q", at)
	}
	if !strings.Contains(f.app(t).LastBackupError, "no database") {
		t.Errorf("a failed manual backup must record why, got %q", f.app(t).LastBackupError)
	}
}
