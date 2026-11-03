package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
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
	// sizes is what each upload weighed, so the size check after a PUT reads
	// back what was sent.
	sizes sync.Map
	// newer is a key listed after the snapshot, taken since: what an empty
	// database backed up would look like.
	newer atomic.Value
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
			n, _ := io.Copy(io.Discard, r.Body)
			bucket.sizes.Store(r.URL.Path, n)
		case r.Method == http.MethodHead:
			n, ok := bucket.sizes.Load(r.URL.Path)
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Length", strconv.FormatInt(n.(int64), 10))
		case r.Method == http.MethodGet && strings.Contains(r.URL.RawQuery, "list-type"):
			w.Header().Set("Content-Type", "application/xml")
			contents := `<Contents><Key>` + key + `</Key><Size>10</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>`
			if newer, _ := bucket.newer.Load().(string); newer != "" {
				contents += `<Contents><Key>` + newer + `</Key><Size>10</Size><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>`
			}
			_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>false</IsTruncated>` + contents + `</ListBucketResult>`))
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
	f.server.runDueBackups(t.Context())

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

// Both guards come from the same moment and end with the same decision: the
// hold keeps the schedule off the empty database, the pending restore keeps
// retention off the real backups, and choosing to keep the new database lifts
// both.
func TestAnUncheckedEmptyStartHoldsUntilDismissed(t *testing.T) {
	f := newBackupFixture(t)
	bucket := newRecoveryBucket(t, f)
	bucket.down.Store(true)
	f.server.maybeAutoRestore(t.Context(), f.app(t), f.databasePath())

	if a := f.app(t); a.BackupHold == "" || a.RestorePending == nil {
		t.Fatalf("hold = %q, pending = %v", a.BackupHold, a.RestorePending)
	}

	req := httptest.NewRequest(http.MethodPost, "/apps/demo/production/restore/dismiss?confirm=yes", nil)
	req.SetPathValue("name", "demo")
	req.SetPathValue("env", "production")
	rec := httptest.NewRecorder()
	f.server.handleRestoreDismiss(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("dismiss: %d %s", rec.Code, rec.Body)
	}
	if a := f.app(t); a.BackupHold != "" || a.RestorePending != nil {
		t.Fatalf("still guarded after a dismiss: hold = %q, pending = %v", a.BackupHold, a.RestorePending)
	}
}

// The safety copy a deploy takes first says nothing about which database is
// the right one: after a failed recovery it is a copy of the empty one, and
// lifting the hold on it would give the empty database back to the schedule.
func TestAPreDeployBackupKeepsTheHold(t *testing.T) {
	f := newBackupFixture(t)
	bucket := newRecoveryBucket(t, f)
	bucket.down.Store(true)
	f.server.maybeAutoRestore(t.Context(), f.app(t), f.databasePath())
	bucket.down.Store(false)

	for _, trigger := range []string{"deploy", "restore", "schedule"} {
		if err := f.server.store.RecordBackup("demo/production", state.BackupRecord{
			At: time.Now().UTC().Format(time.RFC3339), Key: "k", Trigger: trigger}); err != nil {
			t.Fatal(err)
		}
		if f.app(t).BackupHold == "" {
			t.Fatalf("a %s backup lifted the hold", trigger)
		}
	}
}

// Whatever was backed up after the instance started empty is a copy of the
// empty database: "the latest backup" skips it.
func TestARestoreWithoutAKeyIgnoresBackupsOfTheEmptyDatabase(t *testing.T) {
	f := newBackupFixture(t)
	bucket := newRecoveryBucket(t, f)
	bucket.down.Store(true)
	f.server.maybeAutoRestore(t.Context(), f.app(t), f.databasePath())
	bucket.down.Store(false)
	app := f.app(t)
	app.RestorePending.Since = time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
	if err := f.server.store.Upsert(app); err != nil {
		t.Fatal(err)
	}
	bucket.newer.Store("apps/" + naming.Instance("demo", "production") + "/db/" +
		time.Now().UTC().Add(-time.Minute).Format("20060102T150405Z") + ".sqlite.gz")

	req := httptest.NewRequest(http.MethodPost, "/apps/demo/production/restore?dryRun=1", nil)
	req.SetPathValue("name", "demo")
	req.SetPathValue("env", "production")
	rec := httptest.NewRecorder()
	f.server.handleRestore(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), "20260101T000000Z") {
		t.Fatalf("want the snapshot from before the empty start, got %s", rec.Body)
	}
}

// The scheduler and the auto-restore take the same per-instance lock, so a
// scheduled backup can never land between the empty database and its restore.
func TestTheAutoRestoreWaitsForTheBackupLock(t *testing.T) {
	f := newBackupFixture(t)
	newRecoveryBucket(t, f)
	unlock := f.server.lockBackup("demo/production")

	done := make(chan struct{})
	go func() {
		f.server.maybeAutoRestore(context.Background(), f.app(t), f.databasePath())
		close(done)
	}()
	select {
	case <-done:
		unlock()
		t.Fatal("the auto-restore ran while a backup held the lock")
	case <-time.After(200 * time.Millisecond):
	}
	unlock()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("the auto-restore never ran once the lock was free")
	}
}

// A client that hangs up mid-restore must not leave the app stopped half way.
func TestARestoreOutlivesItsRequest(t *testing.T) {
	f := newBackupFixture(t)
	newRecoveryBucket(t, f)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodPost, "/apps/demo/production/restore?confirm=yes", nil).WithContext(ctx)
	req.SetPathValue("name", "demo")
	req.SetPathValue("env", "production")
	rec := httptest.NewRecorder()
	f.server.handleRestore(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body)
	}
}

// The guards protect the backups until the data is back. An app that does not
// boot on the restored database is a different problem: they are lifted anyway.
func TestARestoreThatDoesNotBootStillLiftsTheGuards(t *testing.T) {
	f := newBackupFixture(t)
	bucket := newRecoveryBucket(t, f)
	bucket.down.Store(true)
	f.server.maybeAutoRestore(t.Context(), f.app(t), f.databasePath())
	bucket.down.Store(false)
	f.runner.refuseStart = func(int) error { return errors.New("will not boot") }

	req := httptest.NewRequest(http.MethodPost, "/apps/demo/production/restore?confirm=yes", nil)
	req.SetPathValue("name", "demo")
	req.SetPathValue("env", "production")
	rec := httptest.NewRecorder()
	f.server.handleRestore(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("want the failed start reported, got %d %s", rec.Code, rec.Body)
	}
	if a := f.app(t); a.BackupHold != "" || a.RestorePending != nil {
		t.Fatalf("still guarded after the data came back: hold = %q, pending = %v", a.BackupHold, a.RestorePending)
	}
}
