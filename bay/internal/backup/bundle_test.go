package backup

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/s3/s3test"
)

func TestDiscoverFindsDatabasesByHeaderAndSkipsTheRest(t *testing.T) {
	data := t.TempDir()
	db := "SQLite format 3\x00" + strings.Repeat("x", 100)
	write(t, filepath.Join(data, "app.db"), db)
	write(t, filepath.Join(data, "app.db-wal"), db)
	write(t, filepath.Join(data, "app.db-shm"), db)
	write(t, filepath.Join(data, "app.db.before-restore-20260801T000000Z"), db)
	write(t, filepath.Join(data, "queue", "jobs.anything"), db) // found by its header, whatever its name
	write(t, filepath.Join(data, "notes.txt"), "not a database")
	write(t, filepath.Join(data, "fresh.sqlite"), "") // created, never written: still a database
	write(t, filepath.Join(data, "empty.txt"), "")
	outside := filepath.Join(t.TempDir(), "other.db")
	write(t, outside, db)
	if err := os.Symlink(outside, filepath.Join(data, "linked.db")); err != nil {
		t.Fatal(err)
	}

	files, skipped, err := DiscoverSQLite(data)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(files, ",") != "app.db,fresh.sqlite,queue/jobs.anything" {
		t.Fatalf("files = %v", files)
	}
	if len(skipped) != 1 || !strings.HasPrefix(skipped[0], "linked.db") {
		t.Fatalf("a symbolic link must be skipped AND said, got %v", skipped)
	}
}

func TestRestoreKeyStaysInsideTheApp(t *testing.T) {
	for given, want := range map[string]string{
		prefix + "20260801T000000Z/manifest.json": prefix + "20260801T000000Z/manifest.json",
		prefix + "20260801T000000Z/":              prefix + "20260801T000000Z/manifest.json",
		"20260801T000000Z":                        prefix + "20260801T000000Z/manifest.json",
		prefix + "20260801T000000Z.sqlite.gz":     prefix + "20260801T000000Z.sqlite.gz",
		"20260801T000000Z.sqlite.gz":              prefix + "20260801T000000Z.sqlite.gz",
	} {
		got, _, err := RestoreKey("lore", "production", given)
		if err != nil || got != want {
			t.Errorf("RestoreKey(%q) = %q, %v; want %q", given, got, err, want)
		}
	}
	for _, refused := range []string{
		"apps/shop-production/db/20260801T000000Z/manifest.json", // another app
		prefix + "20260801T000000Z.dump.gz",
		prefix + "../shop-production/db/20260801T000000Z/manifest.json",
		prefix + "notes.txt",
	} {
		if _, _, err := RestoreKey("lore", "production", refused); err == nil {
			t.Errorf("RestoreKey(%q) must refuse", refused)
		}
	}
}

func TestListGroupsBundlesAndKeepsOlderShapes(t *testing.T) {
	srv := s3test.New(t)
	srv.Seed(prefix+"20260801T000000Z.sqlite.gz", []byte("a"))
	srv.Seed(prefix+"20260802T000000Z.dump.gz", []byte("b"))
	srv.Seed(prefix+"20260803T000000Z/files/app.db.gz", []byte("cc"))
	srv.Seed(prefix+"20260803T000000Z/files/queue/jobs.db.gz", []byte("dd"))
	srv.Seed(prefix+"20260803T000000Z/manifest.json", []byte("{}"))
	srv.Seed(prefix+"20260804T000000Z/files/app.db.gz", []byte("e")) // died before its manifest

	entries, err := New(srv.Client(t)).List(context.Background(), "lore", "production")
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, e := range entries {
		got = append(got, e.Kind+":"+filepath.Base(filepath.Dir(e.Key))+"/"+filepath.Base(e.Key))
	}
	want := "bundle:20260803T000000Z/manifest.json,dump:db/20260802T000000Z.dump.gz,sqlite:db/20260801T000000Z.sqlite.gz"
	if strings.Join(got, ",") != want {
		t.Fatalf("got %v, want %s", got, want)
	}
	if entries[0].Files != 2 || entries[0].Size != 6 {
		t.Fatalf("a bundle counts its databases and all its bytes, got %+v", entries[0])
	}
}

func TestPruneRemovesWholeBundlesAndDeadUploads(t *testing.T) {
	srv := s3test.New(t)
	bundle := func(stamp string, complete bool) {
		srv.Seed(prefix+stamp+"/files/app.db.gz", []byte("x"))
		srv.Seed(prefix+stamp+"/files/other.db.gz", []byte("x"))
		if complete {
			srv.Seed(prefix+stamp+"/manifest.json", []byte("{}"))
		}
	}
	srv.Seed(prefix+"20260801T000000Z.sqlite.gz", []byte("old shape"))
	bundle("20260802T000000Z", false) // dead, older than every kept one
	bundle("20260803T000000Z", true)
	bundle("20260804T000000Z", true)
	bundle("20260805T000000Z", true)
	bundle("20260806T000000Z", false) // maybe still uploading

	removed, err := New(srv.Client(t)).Prune(context.Background(), "lore", "production", 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 3 {
		t.Fatalf("want the old snapshot, the oldest bundle and the dead upload removed, got %v", removed)
	}
	var left []string
	for _, k := range srv.Keys() {
		left = append(left, strings.TrimPrefix(k, prefix))
	}
	want := []string{
		"20260804T000000Z/files/app.db.gz", "20260804T000000Z/files/other.db.gz", "20260804T000000Z/manifest.json",
		"20260805T000000Z/files/app.db.gz", "20260805T000000Z/files/other.db.gz", "20260805T000000Z/manifest.json",
		"20260806T000000Z/files/app.db.gz", "20260806T000000Z/files/other.db.gz",
	}
	if strings.Join(left, ",") != strings.Join(want, ",") {
		t.Fatalf("left %v", left)
	}
}

// Every database of data/ goes up in one bundle, its manifest says what the
// data looked like, and the whole of it comes back.
func TestBundleRoundTripsEveryDatabase(t *testing.T) {
	node := nodeWithSQLite(t)
	data := t.TempDir()
	runNode(t, node, `
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
db.exec("PRAGMA journal_mode=WAL; CREATE TABLE notes(body TEXT); CREATE TABLE migrations_public(id INTEGER PRIMARY KEY, name TEXT);");
db.exec("INSERT INTO migrations_public(name) VALUES ('0001_init'), ('0002_notes')");
db.prepare("INSERT INTO notes VALUES (?)").run("from app.db");
db.prepare("INSERT INTO notes VALUES (?)").run("twice");
`, filepath.Join(data, "app.db"))
	if err := os.MkdirAll(filepath.Join(data, "queue"), 0o755); err != nil {
		t.Fatal(err)
	}
	runNode(t, node, `
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
db.exec("CREATE TABLE jobs(name TEXT); INSERT INTO jobs VALUES ('from the queue');");
`, filepath.Join(data, "queue", "jobs.sqlite"))

	srv := s3test.New(t)
	m := New(srv.Client(t))
	ctx := context.Background()
	res, man, err := m.BackupBundle(ctx, "lore", "production", HostRuntime(node), data,
		BundleMeta{Release: "r1", Trigger: "manual", Bay: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Kind != KindBundle || strings.Join(res.Files, ",") != "app.db,queue/jobs.sqlite" || !strings.HasSuffix(res.Key, "/manifest.json") {
		t.Fatalf("result %+v", res)
	}

	// The manifest in the bucket is the one answered, and it describes the data.
	stored, ok := srv.Object(res.Key)
	if !ok {
		t.Fatal("no manifest uploaded")
	}
	var back Manifest
	if err := json.Unmarshal(stored, &back); err != nil {
		t.Fatal(err)
	}
	if back.Format != ManifestFormat || back.Release != "r1" || back.Trigger != "manual" || back.Instance != "lore-production" || len(back.Files) != 2 {
		t.Fatalf("manifest %+v", back)
	}
	app := man.Files[0]
	if app.JournalMode != "wal" || app.Pages == 0 || len(app.SHA256) != 64 {
		t.Fatalf("app.db metadata %+v", app)
	}
	if len(app.Migrations) != 1 || app.Migrations[0].Count != 2 || app.Migrations[0].Last != "0002_notes" {
		t.Fatalf("migrations %+v", app.Migrations)
	}
	if app.TableRows[0].Table != "notes" && app.TableRows[0].Table != "migrations_public" {
		t.Fatalf("table rows %+v", app.TableRows)
	}

	// Data changes, then the bundle is put back over it.
	runNode(t, node, `
const { DatabaseSync } = require("node:sqlite");
new DatabaseSync(process.argv[1]).exec("DELETE FROM jobs");
`, filepath.Join(data, "queue", "jobs.sqlite"))
	write(t, filepath.Join(data, "later.db"), "") // appeared after the backup

	fetched, cleanup, err := m.FetchBundle(ctx, res.Key, HostRuntime(node))
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	untouched, err := InstallBundle(fetched, data)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(untouched, ",") != "later.db" {
		t.Fatalf("a database the bundle does not hold is left alone and named, got %v", untouched)
	}
	out := runNode(t, node, `
const { DatabaseSync } = require("node:sqlite");
console.log(new DatabaseSync(process.argv[1], { readOnly: true }).prepare("SELECT name FROM jobs").get().name);
`, filepath.Join(data, "queue", "jobs.sqlite"))
	if strings.TrimSpace(out) != "from the queue" {
		t.Fatalf("restored queue reads %q", out)
	}
	if matches, _ := filepath.Glob(filepath.Join(data, "queue", "jobs.sqlite.before-restore-*")); len(matches) != 1 {
		t.Fatalf("the replaced database must be set aside, got %v", matches)
	}
}

func TestFetchBundleRefusesWhatTheManifestDoesNotVouchFor(t *testing.T) {
	node := nodeWithSQLite(t)
	data := t.TempDir()
	runNode(t, node, `
const { DatabaseSync } = require("node:sqlite");
new DatabaseSync(process.argv[1]).exec("CREATE TABLE t(x)");
`, filepath.Join(data, "app.db"))
	srv := s3test.New(t)
	m := New(srv.Client(t))
	ctx := context.Background()
	res, man, err := m.BackupBundle(ctx, "lore", "production", HostRuntime(node), data, BundleMeta{})
	if err != nil {
		t.Fatal(err)
	}
	reupload := func(change func(*Manifest)) {
		copy := *man
		copy.Files = append([]ManifestFile(nil), man.Files...)
		change(&copy)
		body, _ := json.Marshal(copy)
		srv.Seed(res.Key, body)
	}

	for name, change := range map[string]func(*Manifest){
		"checksum":    func(m *Manifest) { m.Files[0].SHA256 = strings.Repeat("0", 64) },
		"escape":      func(m *Manifest) { m.Files[0].Path = "../other/app.db" },
		"foreign key": func(m *Manifest) { m.Files[0].Key = "apps/shop-production/db/x/files/app.db.gz" },
		"format":      func(m *Manifest) { m.Format = 99 },
	} {
		reupload(change)
		if _, _, err := m.FetchBundle(ctx, res.Key, HostRuntime(node)); err == nil {
			t.Errorf("%s: a manifest that does not match must be refused", name)
		}
	}
}

func TestInstallBundlePutsEverythingBackWhenOneFails(t *testing.T) {
	data := t.TempDir()
	write(t, filepath.Join(data, "app.db"), "live app")
	staged := t.TempDir()
	write(t, filepath.Join(staged, "0"), "restored app")
	write(t, filepath.Join(staged, "1"), "restored queue")
	// queue/ is a file, so the second database cannot be installed.
	write(t, filepath.Join(data, "queue"), "in the way")

	_, err := InstallBundle(&Fetched{Files: []FetchedFile{
		{Path: "app.db", Local: filepath.Join(staged, "0")},
		{Path: "queue/jobs.db", Local: filepath.Join(staged, "1")},
	}}, data)
	if err == nil {
		t.Fatal("want the install refused")
	}
	if got := read(t, filepath.Join(data, "app.db")); got != "live app" {
		t.Fatalf("app.db must be back as it was, reads %q", got)
	}
	if matches, _ := filepath.Glob(filepath.Join(data, "app.db.before-restore-*")); len(matches) != 0 {
		t.Fatalf("nothing set aside may be left after a rollback, got %v", matches)
	}
}
