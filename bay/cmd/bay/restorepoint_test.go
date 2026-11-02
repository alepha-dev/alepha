package main

import (
	"bytes"
	"compress/gzip"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/s3/s3test"
)

func seedSingleFile(t *testing.T, srv *s3test.Server, key, body string) {
	t.Helper()
	var packed bytes.Buffer
	gz := gzip.NewWriter(&packed)
	_, _ = gz.Write([]byte(body))
	_ = gz.Close()
	srv.Seed(key, packed.Bytes())
}

func readString(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// --at picks the newest backup at or before the time, read in the given zone.
func TestRestoreAtATime(t *testing.T) {
	f, srv, data := bundleFixture(t)
	seedSingleFile(t, srv, "apps/demo-production/db/20200101T000000Z.sqlite.gz", "SQLite format 3\x00january")
	seedSingleFile(t, srv, "apps/demo-production/db/20200201T000000Z.sqlite.gz", "SQLite format 3\x00february")

	rec := f.call(t, http.MethodPost, "/apps/demo/production/restore?confirm=yes&at=2020-01-15+12:00&tz=Europe/Paris", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("restore --at: %d %s", rec.Code, rec.Body)
	}
	if got := readString(t, filepath.Join(data, "app.db")); got != "SQLite format 3\x00january" {
		t.Fatalf("app.db reads %q, want the January backup", got)
	}

	rec = f.call(t, http.MethodPost, "/apps/demo/production/restore?confirm=yes&at=2019-06-01", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("a time before every backup: %d %s", rec.Code, rec.Body)
	}
	rec = f.call(t, http.MethodPost, "/apps/demo/production/restore?confirm=yes&at=2020-01-15&key=x", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("--key with --at: %d %s", rec.Code, rec.Body)
	}
	rec = f.call(t, http.MethodPost, "/apps/demo/production/restore?confirm=yes&at=yesterday", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("an unreadable time: %d %s", rec.Code, rec.Body)
	}
}

// --from restores another instance's backup: staging data into production.
func TestRestoreFromAnotherInstance(t *testing.T) {
	f, srv, data := bundleFixture(t)
	key := "apps/demo-staging/db/20200101T000000Z.sqlite.gz"
	seedSingleFile(t, srv, key, "SQLite format 3\x00staging")

	rec := f.call(t, http.MethodPost, "/apps/demo/production/restore?confirm=yes&key="+key, "")
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "--from") {
		t.Fatalf("another instance's key without --from: %d %s", rec.Code, rec.Body)
	}

	rec = f.call(t, http.MethodPost, "/apps/demo/production/restore?confirm=yes&from=demo/staging", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("restore --from: %d %s", rec.Code, rec.Body)
	}
	if body := decode(t, rec); body["from"] != "demo/staging" || body["restored"] != key {
		t.Fatalf("restore --from answered %v", body)
	}
	if got := readString(t, filepath.Join(data, "app.db")); got != "SQLite format 3\x00staging" {
		t.Fatalf("app.db reads %q", got)
	}

	rec = f.call(t, http.MethodPost, "/apps/demo/production/restore?confirm=yes&from=staging", "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("a --from without env: %d %s", rec.Code, rec.Body)
	}
}

// A dry run reads and verifies the backup, says what it would change, and
// changes nothing - the app keeps running.
func TestRestoreDryRunChangesNothing(t *testing.T) {
	f, _, data := bundleFixture(t)
	if rec := f.backup(t); rec.Code != http.StatusOK {
		t.Fatalf("backup: %d %s", rec.Code, rec.Body)
	}
	writeFile(t, filepath.Join(data, "queue", "jobs.db"), "SQLite format 3\x00queue changed since")
	writeFile(t, filepath.Join(data, "cache.db"), "SQLite format 3\x00not in the backup")
	before := f.runner.starts

	rec := f.call(t, http.MethodPost, "/apps/demo/production/restore?dryRun=1", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("dry run: %d %s", rec.Code, rec.Body)
	}
	body := decode(t, rec)
	if body["dryRun"] != true || body["wouldRestore"] == nil {
		t.Fatalf("dry run answered %v", body)
	}
	if strings.Join(toStrings(body["replaces"]), ",") != "app.db,queue/jobs.db" ||
		strings.Join(toStrings(body["untouched"]), ",") != "cache.db" {
		t.Fatalf("dry run changes: %v", body)
	}
	if got := readString(t, filepath.Join(data, "queue", "jobs.db")); got != "SQLite format 3\x00queue changed since" {
		t.Fatalf("a dry run wrote %q", got)
	}
	if !f.runner.Running("demo/production") || f.runner.starts != before {
		t.Fatal("a dry run must not stop or restart the app")
	}
}

// A restore first backs up the data it replaces, tagged pre-restore, so the
// restore itself can be undone from the bucket.
func TestRestoreTakesAPreRestoreBackup(t *testing.T) {
	f, srv, data := bundleFixture(t)
	key := "apps/demo-production/db/20200101T000000Z.sqlite.gz"
	seedSingleFile(t, srv, key, "SQLite format 3\x00old")
	writeFile(t, filepath.Join(data, "app.db"), "SQLite format 3\x00current")

	rec := f.restore(t, key)
	if rec.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body)
	}
	pre, _ := decode(t, rec)["preRestoreBackup"].(map[string]any)
	preKey, _ := pre["key"].(string)
	if !strings.Contains(preKey, "-pre-restore/") {
		t.Fatalf("no pre-restore backup in the answer: %v", pre)
	}
	if _, ok := srv.Object(preKey); !ok {
		t.Fatalf("the pre-restore backup is not in the bucket: %v", srv.Keys())
	}

	// And it brings back what the restore replaced.
	rec = f.restore(t, preKey)
	if rec.Code != http.StatusOK {
		t.Fatalf("undoing the restore: %d %s", rec.Code, rec.Body)
	}
	if got := readString(t, filepath.Join(data, "app.db")); got != "SQLite format 3\x00current" {
		t.Fatalf("app.db reads %q after undoing the restore", got)
	}
}

// The restore test reads a backup back and records the outcome; a corrupt
// backup fails it, and the failure is kept for status and Lore.
func TestBackupVerify(t *testing.T) {
	f, srv, _ := bundleFixture(t)
	if rec := f.backup(t); rec.Code != http.StatusOK {
		t.Fatalf("backup: %d %s", rec.Code, rec.Body)
	}
	rec := f.call(t, http.MethodPost, "/apps/demo/production/backup/verify", "")
	if rec.Code != http.StatusOK || decode(t, rec)["ok"] != true {
		t.Fatalf("verify: %d %s", rec.Code, rec.Body)
	}
	app := f.app(t)
	if app.LastVerifyAt == "" || app.LastVerifyKey != app.LastBackupKey || app.LastVerifyError != "" {
		t.Fatalf("verify not recorded: %+v", app)
	}

	bad := "apps/demo-production/db/20300101T000000Z.sqlite.gz"
	srv.Seed(bad, []byte("not gzip at all"))
	rec = f.call(t, http.MethodPost, "/apps/demo/production/backup/verify?key="+bad, "")
	if rec.Code != http.StatusUnprocessableEntity || decode(t, rec)["ok"] != false {
		t.Fatalf("verify of a corrupt backup: %d %s", rec.Code, rec.Body)
	}
	if app := f.app(t); app.LastVerifyError == "" || app.LastVerifyKey != bad {
		t.Fatalf("the failure is not recorded: %+v", app)
	}

	// Damage the newest backup in the bucket: --all reports it, per app.
	srv.Seed(strings.TrimSuffix(app.LastBackupKey, "manifest.json")+"files/app.db.gz", []byte("damaged"))
	rec = f.call(t, http.MethodPost, "/backups/verify", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("verify --all: %d %s", rec.Code, rec.Body)
	}
	if body := decode(t, rec); body["failed"] != float64(1) {
		t.Fatalf("verify --all answered %v", body)
	}
}

// The scheduler test-restores an app whose last test is older than the policy
// says, and leaves alone one tested recently.
func TestRunDueVerifies(t *testing.T) {
	f, _, _ := bundleFixture(t)
	if rec := f.backup(t); rec.Code != http.StatusOK {
		t.Fatalf("backup: %d %s", rec.Code, rec.Body)
	}
	f.server.runDueVerifies(t.Context())
	first := f.app(t).LastVerifyAt
	if first == "" || f.app(t).LastVerifyError != "" {
		t.Fatalf("never tested before: the scheduler should have run it: %+v", f.app(t))
	}
	f.server.runDueVerifies(t.Context())
	if f.app(t).LastVerifyAt != first {
		t.Fatal("tested a moment ago: not due again for a week")
	}

	if err := f.server.store.RecordVerify("demo/production", "k", "", time.Now().Add(-8*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	f.server.runDueVerifies(t.Context())
	if f.app(t).LastVerifyKey == "k" {
		t.Fatal("tested eight days ago: due again")
	}

	rec := f.call(t, http.MethodPut, "/config/backup", `{"verify":{"every":"off"}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("turning the test off: %d %s", rec.Code, rec.Body)
	}
	if err := f.server.store.RecordVerify("demo/production", "k", "", time.Now().Add(-30*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	f.server.runDueVerifies(t.Context())
	if f.app(t).LastVerifyKey != "k" {
		t.Fatal("verify.every off: the scheduler must not test")
	}
}
