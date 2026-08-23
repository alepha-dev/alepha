package main

import (
	"bytes"
	"compress/gzip"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alepha/bay/internal/state"
)

// A static site has no database to snapshot. Backing one up used to record a
// failure that only a success can clear, so `bay status` reported the site as
// broken on every run, forever, and every redeploy carried the error forward.
func TestBackupRefusesAStaticSiteWithoutRecordingAFailure(t *testing.T) {
	f := newDeployFixture(t)
	if _, derr := f.deploy(staticArtifact(t)); derr != nil {
		t.Fatal(derr)
	}
	srv := fakeS3(t)
	if err := f.server.store.SetS3(&state.S3Config{S3Target: state.S3Target{
		Endpoint: srv.URL, Bucket: "b", AccessKey: "k", SecretKey: "s", Region: "auto"}, Keep: 7}); err != nil {
		t.Fatal(err)
	}

	rec := f.backup(t)

	if rec.Code != http.StatusPreconditionFailed {
		t.Fatalf("a static site must be refused with 412, got %d: %s", rec.Code, rec.Body)
	}
	if got := f.app(t).LastBackupError; got != "" {
		t.Fatalf("a refusal is not a failed attempt, recorded %q", got)
	}
	if err := printStatusJSON([]listedApp{{App: f.app(t)}}, time.Now(), 24*time.Hour); err != nil {
		t.Fatalf("status must not report a problem for the site: %v", err)
	}
}

// A restore that cannot set the live database aside must not also be an
// outage: the app was stopped for the restore, and it used to stay stopped.
func TestFailedRestoreRestartsTheApp(t *testing.T) {
	f := newDeployFixture(t)
	if _, derr := f.deploy(deployableArtifact(t)); derr != nil {
		t.Fatal(derr)
	}
	snapshotCapableNode(t, filepath.Join(f.root, "runtimes", "node-24", "bin", "node"))
	dataDir := filepath.Join(f.root, "apps", "demo", "production", "data")
	if err := os.WriteFile(filepath.Join(dataDir, "app.db"), []byte("SQLite format 3\x00"), 0o644); err != nil {
		t.Fatal(err)
	}
	var packed bytes.Buffer
	gz := gzip.NewWriter(&packed)
	_, _ = gz.Write([]byte("SQLite format 3\x00restored"))
	_ = gz.Close()
	key := "apps/demo/production/db/20260101T000000Z.sqlite.gz"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Query().Get("list-type") == "2" {
			w.Header().Set("Content-Type", "application/xml")
			_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>` + key + `</Key><Size>10</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents></ListBucketResult>`))
			return
		}
		if r.Method == http.MethodGet {
			_, _ = w.Write(packed.Bytes())
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	if err := f.server.store.SetS3(&state.S3Config{S3Target: state.S3Target{
		Endpoint: srv.URL, Bucket: "b", AccessKey: "k", SecretKey: "s", Region: "auto"}, Keep: 7}); err != nil {
		t.Fatal(err)
	}
	if !f.runner.Running("demo/production") {
		t.Fatal("fixture: app should be running")
	}
	// Setting the database aside (the first step of the install) must fail
	// while the live file stays in place. Not through mode bits: root ignores
	// them, and the CI container runs as root. A directory already sitting at
	// the set-aside name makes rename(2) refuse for every uid, so one is
	// planted for each second the stamp can land on.
	occupySetAsideNames(t, filepath.Join(dataDir, "app.db"))

	req := httptest.NewRequest(http.MethodPost, "/apps/demo/production/restore?confirm=yes", nil)
	req.SetPathValue("name", "demo")
	req.SetPathValue("env", "production")
	rec := httptest.NewRecorder()
	f.server.handleRestore(rec, req)

	if rec.Code == http.StatusOK {
		t.Fatalf("the restore must fail, got %d: %s", rec.Code, rec.Body)
	}
	if !f.runner.Running("demo/production") {
		t.Fatalf("the app must come back on its untouched database after a refused restore: %s", rec.Body)
	}
}

// A storage migration that fails AFTER the files were copied (rewriting `.env`
// here) must put the app back, like the failing-copy path always did.
func TestFailedMigrationAfterTheCopyRestartsTheApp(t *testing.T) {
	f := localAppWithUploads(t)
	var puts []string
	blobs := recordingS3(t, &puts)
	if err := f.server.store.SetStorage(&state.S3Target{
		Endpoint: blobs.URL, Bucket: "bay-blobs", AccessKey: "a", SecretKey: "b", Region: "auto"}); err != nil {
		t.Fatal(err)
	}
	if !f.runner.Running("demo/production") {
		t.Fatal("fixture: app should be running")
	}
	// The rewrite itself refuses. Through the seam, not the filesystem: the
	// restart that follows reads the same `.env`, so anything that breaks the
	// write breaks the recovery too, and mode bits mean nothing to root (the
	// CI container runs as root).
	f.server.repoint = func(string, string, string, *state.S3Target) error {
		return errors.New("rewrite refused")
	}

	rec := migrateStorage(t, f)

	if rec.Code == http.StatusOK {
		t.Fatalf("the migration must fail at the repoint, got %d: %s", rec.Code, rec.Body)
	}
	if len(puts) == 0 {
		t.Fatal("the failure must come after the copy, yet nothing was uploaded")
	}
	if !f.runner.Running("demo/production") {
		t.Fatalf("the app must come back on local storage after a failed repoint: %s", rec.Body)
	}
}

// occupySetAsideNames plants a directory at every name the set-aside rename
// can pick for livePath in the next few seconds. The stamp is second-resolution
// UTC (backup.timeLayout), taken when the rename runs.
func occupySetAsideNames(t *testing.T, livePath string) {
	t.Helper()
	now := time.Now().UTC()
	for offset := -1; offset <= 5; offset++ {
		stamp := now.Add(time.Duration(offset) * time.Second).Format("20060102T150405Z")
		if err := os.Mkdir(livePath+".before-restore-"+stamp, 0o755); err != nil {
			t.Fatal(err)
		}
	}
}
