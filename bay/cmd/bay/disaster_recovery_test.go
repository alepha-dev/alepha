package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/s3/s3test"
	"github.com/alepha-dev/bay/internal/state"
)

/*
The disaster recovery the backups exist for, end to end: an app with real data
is backed up, removed with its data, and deployed again; it must come back on
its rows, not on an empty database.

Real SQLite throughout: the rows are written and read by `node:sqlite`, and
the backup's snapshot, restore test and install run Bay's own helper on that
same node, so this skips (and says `ok`) where node has no `node:sqlite`, as
the backup round trip in `internal/backup` does. The bucket is the in-memory
S3 server.
*/
func TestARemovedAppDeployedAgainComesBackOnItsData(t *testing.T) {
	node := hostNodeWithSQLite(t)
	f, _ := recoveryHost(t, node)
	artifact := artifactWithDatabase(t)

	first, failure := f.deploy(artifact)
	if failure != nil {
		t.Fatalf("first deploy: %v", failure)
	}
	if got := first.Restore["database"]; got != "empty (no backup found)" {
		t.Fatalf("a first deploy with an empty bucket starts empty, said %v", first.Restore)
	}
	db := f.databasePath()
	sqlite(t, node, db, `
		db.exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, label TEXT)");
		db.exec("INSERT INTO orders (label) VALUES ('first'), ('second'), ('third')");
	`)

	if rec := f.backup(t); rec.Code != http.StatusOK {
		t.Fatalf("backup: %d %s", rec.Code, rec.Body)
	}

	if rec := removeRequest(t, f.server, "?purge=yes"); rec.Code != http.StatusOK {
		t.Fatalf("remove: %d %s", rec.Code, rec.Body)
	}
	if _, err := os.Stat(db); !os.IsNotExist(err) {
		t.Fatalf("the purge must take the database with it: %v", err)
	}

	// Backup keys are stamped to the second, and a deploy never restores one
	// stamped with its own starting second (it may be of the empty database
	// the deploy just created): the redeploy starts in the next second.
	time.Sleep(time.Until(time.Now().Truncate(time.Second).Add(time.Second + 50*time.Millisecond)))
	starts := f.runner.starts

	again, failure := f.deploy(artifact)
	if failure != nil {
		t.Fatalf("redeploy: %v", failure)
	}
	if got, _ := again.Restore["database"].(string); !strings.HasPrefix(got, "restored from ") {
		t.Fatalf("the redeploy must restore the backup, said %v", again.Restore)
	}
	if got := sqlite(t, node, db, `
		process.stdout.write(db.prepare("SELECT group_concat(label) AS l FROM orders ORDER BY id").get().l);
	`); got != "first,second,third" {
		t.Fatalf("the rows after the redeploy read %q", got)
	}
	// Restored BEFORE the start, so the app opened the recovered database.
	if f.runner.starts <= starts || !f.runner.Running("demo/production") {
		t.Fatal("the app must be started on the restored data")
	}
	app := f.app(t)
	if app.RestorePending != nil || app.BackupHold != "" {
		t.Fatalf("a recovery that worked leaves no guard: pending %v, hold %q", app.RestorePending, app.BackupHold)
	}
	if r := app.LastRestore; r == nil || r.Trigger != "deploy" || r.Status != "done" {
		t.Fatalf("the auto-restore is recorded: %+v", r)
	}
}

// The same recovery with the bucket down: the deploy still goes ahead, on an
// empty database, and the guards keep the backup that was missed. Once the
// bucket is back, `bay restore` brings the rows.
func TestARedeployWhileTheBucketIsDownKeepsTheBackupForLater(t *testing.T) {
	node := hostNodeWithSQLite(t)
	f, srv := recoveryHost(t, node)
	artifact := artifactWithDatabase(t)

	if _, failure := f.deploy(artifact); failure != nil {
		t.Fatalf("first deploy: %v", failure)
	}
	db := f.databasePath()
	sqlite(t, node, db, `
		db.exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, label TEXT)");
		db.exec("INSERT INTO orders (label) VALUES ('kept')");
	`)
	if rec := f.backup(t); rec.Code != http.StatusOK {
		t.Fatalf("backup: %d %s", rec.Code, rec.Body)
	}
	if rec := removeRequest(t, f.server, "?purge=yes"); rec.Code != http.StatusOK {
		t.Fatalf("remove: %d %s", rec.Code, rec.Body)
	}
	time.Sleep(time.Until(time.Now().Truncate(time.Second).Add(time.Second + 50*time.Millisecond)))

	srv.Fail = func(*http.Request) int { return http.StatusServiceUnavailable }
	again, failure := f.deploy(artifact)
	if failure != nil {
		t.Fatalf("a bucket down must not fail the deploy: %v", failure)
	}
	if warning, _ := again.Restore["warning"].(string); warning == "" {
		t.Fatalf("the deploy must warn that it started empty, said %v", again.Restore)
	}
	app := f.app(t)
	if app.RestorePending == nil || app.BackupHold == "" {
		t.Fatalf("an unchecked empty start is guarded: pending %v, hold %q", app.RestorePending, app.BackupHold)
	}

	srv.Fail = nil
	if rec := f.restore(t, ""); rec.Code != http.StatusOK {
		t.Fatalf("restore once the bucket is back: %d %s", rec.Code, rec.Body)
	}
	if got := sqlite(t, node, db, `
		process.stdout.write(db.prepare("SELECT label FROM orders").get().label);
	`); got != "kept" {
		t.Fatalf("the row after the restore reads %q", got)
	}
	if app := f.app(t); app.RestorePending != nil || app.BackupHold != "" {
		t.Fatalf("the restore lifts the guards: pending %v, hold %q", app.RestorePending, app.BackupHold)
	}
}

// recoveryHost is a host with a bucket configured and the backup tasks run by
// a real node, before anything is deployed.
func recoveryHost(t *testing.T, node string) (*deployFixture, *s3test.Server) {
	t.Helper()
	f := newDeployFixture(t)
	f.runner.node = node
	srv := s3test.New(t)
	if err := f.server.store.SetS3(&state.S3Config{S3Target: state.S3Target{
		Endpoint: srv.URL, Bucket: srv.Bucket, AccessKey: "AK", SecretKey: "SK", Region: "auto"}, Keep: 7}); err != nil {
		t.Fatal(err)
	}
	return f, srv
}

func hostNodeWithSQLite(t *testing.T) string {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not on PATH")
	}
	if err := exec.Command(node, "-e", `require("node:sqlite")`).Run(); err != nil {
		t.Skip("this node has no node:sqlite")
	}
	return node
}

// sqlite runs body with `db` open on path, and answers what it wrote to stdout.
func sqlite(t *testing.T, node, path, body string) string {
	t.Helper()
	script := `const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
` + body + `
db.close();`
	cmd := exec.Command(node, "-e", script, path)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("node: %v\n%s", err, stderr.String())
	}
	return string(out)
}

// artifactWithDatabase is deployableArtifact declaring a database, which Bay
// provisions (an empty app.db on the first deploy) and backs up.
func artifactWithDatabase(t *testing.T) string {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, body := range map[string]string{
		"manifest.json": `{
			"project": "demo",
			"resources": {"hasDatabase": true},
			"runtimes": [{"runtime": "node", "entry": "index.js", "runtimeVersion": "24"}]
		}`,
		"index.node.js": "process.exit(0)",
	} {
		if err := tw.WriteHeader(&tar.Header{Name: name, Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(body))}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "artifact.tar.gz")
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}
