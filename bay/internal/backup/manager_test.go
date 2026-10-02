package backup

import (
	"context"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/s3/s3test"
)

const prefix = "apps/lore-production/db/"

func seedBackups(srv *s3test.Server, stamps ...string) {
	for _, s := range stamps {
		srv.Seed(prefix+s+".sqlite.gz", []byte(s))
	}
}

func TestListIsNewestFirstAndSkipsForeignKeys(t *testing.T) {
	srv := s3test.New(t)
	seedBackups(srv, "20260801T000000Z", "20260803T000000Z", "20260802T000000Z")
	srv.Seed(prefix+"notes.txt", nil)
	srv.Seed("apps/lore-staging/db/20260901T000000Z.sqlite.gz", nil)

	m := New(srv.Client(t))
	entries, err := m.List(context.Background(), "lore", "production")
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, e := range entries {
		got = append(got, e.Timestamp.Format(timeLayout))
	}
	if strings.Join(got, ",") != "20260803T000000Z,20260802T000000Z,20260801T000000Z" {
		t.Fatalf("want this env's backups only, newest first, got %v", got)
	}

	latest, ok, err := m.Latest(context.Background(), "lore", "production")
	if err != nil || !ok || latest.Timestamp.Format(timeLayout) != "20260803T000000Z" {
		t.Fatalf("Latest = %+v, %v, %v", latest, ok, err)
	}
	if _, ok, err := m.Latest(context.Background(), "nothing", "here"); ok || err != nil {
		t.Fatalf("an empty prefix is no backup and no error, got %v, %v", ok, err)
	}
}

func TestPruneKeepsTheNewest(t *testing.T) {
	srv := s3test.New(t)
	seedBackups(srv, "20260801T000000Z", "20260802T000000Z", "20260803T000000Z", "20260804T000000Z")
	srv.Seed(prefix+"notes.txt", nil)
	m := New(srv.Client(t))

	removed, err := m.Prune(context.Background(), "lore", "production", 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 2 {
		t.Fatalf("want the two oldest reported as removed, got %+v", removed)
	}
	want := []string{
		prefix + "20260803T000000Z.sqlite.gz",
		prefix + "20260804T000000Z.sqlite.gz",
		prefix + "notes.txt", // not ours, so never a candidate
	}
	if got := srv.Keys(); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("bucket after prune:\n got  %v\n want %v", got, want)
	}

	// Under the limit is a no-op that touches nothing.
	before := srv.Requests(http.MethodDelete)
	if removed, err := m.Prune(context.Background(), "lore", "production", 5); err != nil || removed != nil {
		t.Fatalf("Prune under the limit = %v, %v", removed, err)
	}
	if srv.Requests(http.MethodDelete) != before {
		t.Fatal("Prune under the limit must not delete")
	}
}

func TestPruneRefusesToKeepNothing(t *testing.T) {
	srv := s3test.New(t)
	seedBackups(srv, "20260801T000000Z")
	if _, err := New(srv.Client(t)).Prune(context.Background(), "lore", "production", 0); err == nil {
		t.Fatal("keep=0 would delete every backup; it must be refused")
	}
	if len(srv.Keys()) != 1 {
		t.Fatal("a refused prune deleted something")
	}
}

func TestPruneReportsWhatItRemovedBeforeAFailure(t *testing.T) {
	srv := s3test.New(t)
	seedBackups(srv, "20260801T000000Z", "20260802T000000Z", "20260803T000000Z")
	srv.Fail = func(r *http.Request) int {
		if r.Method == http.MethodDelete && strings.Contains(r.URL.Path, "20260801") {
			return http.StatusInternalServerError
		}
		return 0
	}
	removed, err := New(srv.Client(t)).Prune(context.Background(), "lore", "production", 1)
	if err == nil {
		t.Fatal("want the delete failure surfaced")
	}
	if len(removed) != 1 || !strings.Contains(removed[0].Key, "20260802") {
		t.Fatalf("want the one deletion that happened reported, got %+v", removed)
	}
}

func TestInstallSetsTheOldDatabaseAsideWithItsWAL(t *testing.T) {
	dir := t.TempDir()
	live := filepath.Join(dir, "data", "app.sqlite")
	write(t, live, "old")
	write(t, live+"-wal", "old-wal")
	write(t, live+"-shm", "old-shm")
	restored := filepath.Join(dir, "restored.sqlite")
	write(t, restored, "new")

	if err := Install(restored, live); err != nil {
		t.Fatal(err)
	}
	if got := read(t, live); got != "new" {
		t.Fatalf("live database = %q", got)
	}
	for _, sidecar := range []string{live + "-wal", live + "-shm"} {
		if _, err := os.Stat(sidecar); !os.IsNotExist(err) {
			t.Fatalf("%s must not sit next to the restored database", sidecar)
		}
	}

	asides, _ := filepath.Glob(live + ".before-restore-*")
	var main string
	for _, a := range asides {
		if !strings.HasSuffix(a, "-wal") && !strings.HasSuffix(a, "-shm") {
			main = a
		}
	}
	if main == "" || read(t, main) != "old" || read(t, main+"-wal") != "old-wal" || read(t, main+"-shm") != "old-shm" {
		t.Fatalf("the previous database and its WAL/SHM must be kept together, got %v", asides)
	}
}

func TestInstallIntoAnEmptyPlace(t *testing.T) {
	dir := t.TempDir()
	live := filepath.Join(dir, "fresh", "app.sqlite")
	restored := filepath.Join(dir, "restored.sqlite")
	write(t, restored, "new")
	// A stale WAL with no database must still be removed.
	if err := os.MkdirAll(filepath.Dir(live), 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, live+"-wal", "stale")

	if err := Install(restored, live); err != nil {
		t.Fatal(err)
	}
	if read(t, live) != "new" {
		t.Fatal("restored database not installed")
	}
	if _, err := os.Stat(live + "-wal"); !os.IsNotExist(err) {
		t.Fatal("a stale WAL would be replayed onto the restored pages")
	}
}

func TestSnapshotGuards(t *testing.T) {
	dir := t.TempDir()
	db := filepath.Join(dir, "app.sqlite")
	write(t, db, "x")

	// Neither guard may reach the runtime, so a runtime that does not exist
	// proves the refusal happened first.
	if _, err := Snapshot(context.Background(), "/nonexistent/runtime", db, db); err == nil ||
		!strings.Contains(err.Error(), "same file") {
		t.Fatalf("VACUUM INTO the live database must be refused, got %v", err)
	}
	other := filepath.Join(dir, "exists.sqlite")
	write(t, other, "y")
	if _, err := Snapshot(context.Background(), "/nonexistent/runtime", db, other); err == nil ||
		!strings.Contains(err.Error(), "already exists") {
		t.Fatalf("an existing destination must be refused, got %v", err)
	}
}

func TestBackupRefusesAMissingDatabase(t *testing.T) {
	srv := s3test.New(t)
	_, err := New(srv.Client(t)).Backup(context.Background(), "lore", "production", "node",
		filepath.Join(t.TempDir(), "absent.sqlite"))
	if err == nil {
		t.Fatal("want an error for a database that is not there")
	}
	if srv.Requests(http.MethodPut) != 0 {
		t.Fatal("nothing may be uploaded")
	}
}

func TestFetchRefusesWhatIsNotGzip(t *testing.T) {
	srv := s3test.New(t)
	srv.Seed(prefix+"20260801T000000Z.sqlite.gz", []byte("not gzip"))
	_, _, err := New(srv.Client(t)).Fetch(context.Background(), prefix+"20260801T000000Z.sqlite.gz", "node")
	if err == nil || !strings.Contains(err.Error(), "decompress") {
		t.Fatalf("want a decompress error, got %v", err)
	}
}

func TestGzipRoundTrip(t *testing.T) {
	raw := []byte(strings.Repeat("sqlite page ", 1000))
	packed, err := gzipBytes(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(packed) >= len(raw) {
		t.Fatalf("repetitive input should compress: %d -> %d", len(raw), len(packed))
	}
	back, err := gunzipBytes(packed)
	if err != nil || string(back) != string(raw) {
		t.Fatalf("round trip lost data: %v", err)
	}
}

func TestLastLine(t *testing.T) {
	cases := map[string]string{
		"(node:1) ExperimentalWarning\n{\"a\":1}\n": `{"a":1}`,
		"{\"a\":1}\n\n   \n":                        `{"a":1}`,
		"":                                          "",
	}
	for in, want := range cases {
		if got := lastLine([]byte(in)); got != want {
			t.Errorf("lastLine(%q) = %q, want %q", in, got, want)
		}
	}
}

// The full path: a live database with a WAL, snapshotted by the app's own
// runtime, uploaded, fetched back, verified and installed. Needs a Node with
// node:sqlite, which is the runtime Bay's apps ship on; skipped otherwise,
// because Bay itself carries no SQLite.
func TestBackupFetchInstallRoundTrip(t *testing.T) {
	node := nodeWithSQLite(t)
	dir := t.TempDir()
	live := filepath.Join(dir, "app.sqlite")
	runNode(t, node, `
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
db.exec("PRAGMA journal_mode=WAL; CREATE TABLE notes(body TEXT); CREATE TABLE tags(name TEXT);");
db.prepare("INSERT INTO notes VALUES (?)").run("kept across the round trip");
`, live)

	srv := s3test.New(t)
	m := New(srv.Client(t))
	ctx := context.Background()

	res, err := m.Backup(ctx, "lore", "production", node, live)
	if err != nil {
		t.Fatal(err)
	}
	if res.Tables != 2 || res.StoredBytes == 0 || !strings.HasPrefix(res.Key, prefix) {
		t.Fatalf("unexpected result %+v", res)
	}

	path, cleanup, err := m.Fetch(ctx, res.Key, node)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()

	target := filepath.Join(dir, "restored", "app.sqlite")
	if err := Install(path, target); err != nil {
		t.Fatal(err)
	}
	out := runNode(t, node, `
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1], { readOnly: true });
console.log(db.prepare("SELECT body FROM notes").get().body);
`, target)
	if strings.TrimSpace(out) != "kept across the round trip" {
		t.Fatalf("restored database reads %q", out)
	}
}

func TestFetchRefusesACorruptDatabase(t *testing.T) {
	node := nodeWithSQLite(t)
	packed, err := gzipBytes([]byte(strings.Repeat("this is not a database", 100)))
	if err != nil {
		t.Fatal(err)
	}
	srv := s3test.New(t)
	key := prefix + "20260801T000000Z.sqlite.gz"
	srv.Seed(key, packed)
	if _, _, err := New(srv.Client(t)).Fetch(context.Background(), key, node); err == nil {
		t.Fatal("a corrupt backup must never be handed to Install")
	}
}

func nodeWithSQLite(t *testing.T) string {
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

func runNode(t *testing.T, node, script string, args ...string) string {
	t.Helper()
	out, err := exec.Command(node, append([]string{"-e", script}, args...)...).CombinedOutput()
	if err != nil {
		t.Fatalf("node: %v\n%s", err, out)
	}
	return string(out)
}

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func read(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
