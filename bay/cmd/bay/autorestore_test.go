package main

import (
	"bytes"
	"compress/gzip"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/state"
)

// recoveryBucket is the backups bucket of a host being recovered: it holds one
// snapshot, it can be unreachable, and it counts what is uploaded to it.
type recoveryBucket struct {
	down    atomic.Bool
	uploads atomic.Int32
}

func newRecoveryBucket(t *testing.T, f *deployFixture) *recoveryBucket {
	t.Helper()
	bucket := &recoveryBucket{}
	key := "apps/" + naming.Instance("demo", "production") + "/db/20260101T000000Z.sqlite.gz"
	var packed bytes.Buffer
	gz := gzip.NewWriter(&packed)
	_, _ = gz.Write([]byte("SQLite format 3\x00restored"))
	_ = gz.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case bucket.down.Load():
			w.WriteHeader(http.StatusForbidden)
		case r.Method == http.MethodPut:
			bucket.uploads.Add(1)
		case r.Method == http.MethodGet && strings.Contains(r.URL.RawQuery, "list-type"):
			w.Header().Set("Content-Type", "application/xml")
			_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>` + key + `</Key><Size>10</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents></ListBucketResult>`))
		case r.Method == http.MethodGet:
			_, _ = w.Write(packed.Bytes())
		}
	}))
	t.Cleanup(srv.Close)
	if err := f.server.store.SetS3(&state.S3Config{S3Target: state.S3Target{
		Endpoint: srv.URL, Bucket: "b", AccessKey: "k", SecretKey: "s", Region: "auto"}, Keep: 7}); err != nil {
		t.Fatal(err)
	}
	return bucket
}

func (f *deployFixture) databasePath() string {
	return filepath.Join(f.root, "apps", naming.Instance("demo", "production"), "data", "app.db")
}

// A host being recovered could not restore the snapshot in the bucket. The app
// runs on an empty database, and the schedule must not store that as the newest
// snapshot once the bucket is back: a plain `bay restore` would then install it.
func TestAFailedAutoRestoreKeepsTheScheduleOffTheEmptyDatabase(t *testing.T) {
	f := newBackupFixture(t)
	bucket := newRecoveryBucket(t, f)
	bucket.down.Store(true)

	f.server.maybeAutoRestore(t.Context(), f.app(t), f.databasePath())
	bucket.down.Store(false)
	f.server.runDueBackups(t.Context(), time.Hour)

	if got := bucket.uploads.Load(); got != 0 {
		t.Fatalf("the schedule uploaded %d snapshot(s) of the empty database", got)
	}
}

// `alepha deploy` keeps what the answer says, so the failure has to be there as
// a warning rather than inside a value only a person reads.
func TestAFailedAutoRestoreWarnsTheDeploy(t *testing.T) {
	f := newBackupFixture(t)
	bucket := newRecoveryBucket(t, f)
	bucket.down.Store(true)

	restore := f.server.maybeAutoRestore(t.Context(), f.app(t), f.databasePath())

	warning, _ := restore["warning"].(string)
	if !strings.Contains(warning, "bay restore demo/production") {
		t.Fatalf("the warning must name the way back, got %q in %v", warning, restore)
	}
}

// New apps have no backup yet, and they are the ordinary case: the first
// scheduled snapshot of an empty database is exactly what should happen.
func TestAFirstDeployWithNothingToRestoreIsNotHeld(t *testing.T) {
	f := newBackupFixture(t)

	restore := f.server.maybeAutoRestore(t.Context(), f.app(t), f.databasePath())

	if _, warned := restore["warning"]; warned {
		t.Fatalf("nothing failed, got %v", restore)
	}
	if got := f.app(t).BackupHold; got != "" {
		t.Fatalf("nothing failed, but backups are held: %q", got)
	}
}

func TestAHeldBackupIsAProblemInStatus(t *testing.T) {
	f := newBackupFixture(t)
	bucket := newRecoveryBucket(t, f)
	bucket.down.Store(true)
	f.server.maybeAutoRestore(t.Context(), f.app(t), f.databasePath())

	line := computeStatus(listedApp{App: f.app(t), Running: true}, time.Now(), 24*time.Hour)

	if !strings.Contains(strings.Join(line.Problems, "\n"), "scheduled backups are held") {
		t.Fatalf("problems = %v", line.Problems)
	}
}

func TestAHoldSurvivesARedeploy(t *testing.T) {
	f := newBackupFixture(t)
	bucket := newRecoveryBucket(t, f)
	bucket.down.Store(true)
	f.server.maybeAutoRestore(t.Context(), f.app(t), f.databasePath())

	if _, derr := f.deploy(deployableArtifact(t)); derr != nil {
		t.Fatal(derr)
	}

	if f.app(t).BackupHold == "" {
		t.Fatal("a redeploy changes nothing about the snapshot still in the bucket")
	}
}

func TestARestoreLiftsTheHold(t *testing.T) {
	f := newBackupFixture(t)
	bucket := newRecoveryBucket(t, f)
	bucket.down.Store(true)
	f.server.maybeAutoRestore(t.Context(), f.app(t), f.databasePath())
	bucket.down.Store(false)

	req := httptest.NewRequest(http.MethodPost, "/apps/demo/production/restore?confirm=yes", nil)
	req.SetPathValue("name", "demo")
	req.SetPathValue("env", "production")
	rec := httptest.NewRecorder()
	f.server.handleRestore(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body)
	}
	if got := f.app(t).BackupHold; got != "" {
		t.Fatalf("backups stayed held after the restore: %q", got)
	}
}

// Someone who decides the empty database is the real one says so with a backup,
// which is the only write to the bucket a person asked for.
func TestABackupTakenByHandLiftsTheHold(t *testing.T) {
	f := newBackupFixture(t)
	bucket := newRecoveryBucket(t, f)
	bucket.down.Store(true)
	f.server.maybeAutoRestore(t.Context(), f.app(t), f.databasePath())
	bucket.down.Store(false)

	if rec := f.backup(t); rec.Code != http.StatusOK {
		t.Fatalf("backup: %d %s", rec.Code, rec.Body)
	}

	if got := f.app(t).BackupHold; got != "" {
		t.Fatalf("backups stayed held after a backup by hand: %q", got)
	}
}
