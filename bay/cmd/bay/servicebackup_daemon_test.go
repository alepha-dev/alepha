package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	neturl "net/url"
	"os/exec"
	"path"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/runner"
	"github.com/alepha-dev/bay/internal/s3/s3test"
	"github.com/alepha-dev/bay/internal/state"
)

func backedUpCompose(failing string) string {
	return `services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U app -d app"]
      interval: 1s
      timeout: 3s
      retries: 30
    x-lore:
      backup:
        postgres: {user: app, db: app}
  files:
    image: busybox:1.37
    command: ["sh", "-c", "mkdir -p /data && echo kept > /data/note && sleep 3600"]
    volumes: [filedata:/data]
    x-lore:
      backup:
        command: "tar -cf - -C /data ."
        restore: "tar -xf - -C /data"
  broken:
    image: busybox:1.37
    command: ["sleep", "3600"]
    x-lore:
      backup:
        command: "` + failing + `"
  cache:
    image: busybox:1.37
    command: ["sleep", "3600"]
    volumes: [cachedata:/data]
volumes:
  pgdata:
  filedata:
  cachedata:
`
}

func TestServiceBackupDaemon(t *testing.T) {
	d := daemonDocker(t)
	requireComposeCLI(t)
	a := newAcceptanceServer(t, d)
	srv := s3test.New(t)
	if err := a.store.SetS3(&state.S3Config{S3Target: state.S3Target{Endpoint: srv.URL, Bucket: srv.Bucket,
		AccessKey: "AK", SecretKey: "SK", Region: "auto"}, Keep: 2}); err != nil {
		t.Fatal(err)
	}
	env := "bk" + strconv.FormatInt(time.Now().UnixNano()%1e9, 36)
	t.Cleanup(func() { a.purge("shop", env) })
	if _, err := a.deployStack(context.Background(), stackDeployOptions{Stack: "shop", Env: env,
		Bundle: tarGz(t, t.TempDir(), "r1.tar.gz", map[string]string{"compose.yml": backedUpCompose("true")})}); err != nil {
		t.Fatal(err)
	}
	member := func(service string) state.App {
		m, ok := a.store.Get(memberKey("shop", env, service))
		if !ok {
			t.Fatalf("no member %s", service)
		}
		return m
	}

	t.Run("the deploy records each hook and marks the member as backed up", func(t *testing.T) {
		db := member("db")
		if !db.Backups || db.BackupHook == nil || db.BackupHook.PostgresDB != "app" {
			t.Fatalf("db = %+v", db)
		}
		if f := member("files"); f.BackupHook == nil || f.BackupHook.Restore != "tar -xf - -C /data" {
			t.Fatalf("files = %+v", f)
		}
	})

	t.Run("bay backup on a postgres service uploads a verified pg_dump", func(t *testing.T) {
		rec := httptest.NewRecorder()
		a.controlMux().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/apps/shop.db/"+env+"/backup", nil))
		if rec.Code != 200 || !strings.Contains(rec.Body.String(), ".dump.gz") || !strings.Contains(rec.Body.String(), "not its disk") {
			t.Fatalf("%d %s", rec.Code, rec.Body.String())
		}
		if m := member("db"); m.LastBackupAt == "" || !strings.HasSuffix(m.LastBackupKey, ".dump.gz") {
			t.Fatalf("not recorded: %+v", m)
		}
		packed, _ := srv.Object(member("db").LastBackupKey)
		zr, err := gzip.NewReader(bytes.NewReader(packed))
		var raw []byte
		if err == nil {
			raw, err = io.ReadAll(zr)
		}
		if err != nil || !strings.HasPrefix(string(raw), "PGDMP") {
			t.Fatalf("stored object is not a custom-format dump: %.20q %v", raw, err)
		}
	})

	t.Run("a command hook's stdout is the dump", func(t *testing.T) {
		out, err := a.backupInstance(context.Background(), member("files"))
		if err != nil || out.Result.RawBytes == 0 {
			t.Fatalf("%+v %v", out, err)
		}
	})

	t.Run("a hook that writes nothing is a failed backup, recorded", func(t *testing.T) {
		if _, err := a.backupInstance(context.Background(), member("broken")); err == nil || !strings.Contains(err.Error(), "wrote nothing") {
			t.Fatalf("err = %v", err)
		}
		if m := member("broken"); m.LastBackupError == "" || m.LastBackupAt != "" {
			t.Fatalf("not recorded as failed: %+v", m)
		}
	})

	t.Run("a volume no hook covers is named in the backup response, status, volumes and inventory", func(t *testing.T) {
		out, err := a.backupInstance(context.Background(), member("db"))
		if err != nil || !strings.Contains(strings.Join(out.NotBackedUp, "|"), "not backed up: volume cachedata") ||
			strings.Contains(strings.Join(out.NotBackedUp, "|"), "volume pgdata") {
			t.Fatalf("notBackedUp = %v, %v", out.NotBackedUp, err)
		}
		for _, l := range a.listApps() {
			want := l.Service == "cache"
			if l.Stack == "shop" && l.Env == env && (len(l.NotBackedUp) == 1) != want {
				t.Fatalf("%s notBackedUp = %v", l.Service, l.NotBackedUp)
			}
		}
		rec := httptest.NewRecorder()
		a.controlMux().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/stacks/shop/"+env+"/volumes", nil))
		var body struct {
			Volumes []struct {
				Volume    string   `json:"volume"`
				SizeBytes *int64   `json:"sizeBytes"`
				CoveredBy []string `json:"coveredBy"`
				BackedUp  bool     `json:"backedUp"`
			} `json:"volumes"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || len(body.Volumes) != 3 {
			t.Fatalf("%d %s", rec.Code, rec.Body.String())
		}
		for _, v := range body.Volumes {
			if v.SizeBytes == nil || v.BackedUp != (v.Volume != "cachedata") {
				t.Fatalf("volume %+v", v)
			}
			if v.Volume == "pgdata" && strings.Join(v.CoveredBy, ",") != "db" {
				t.Fatalf("pgdata covered by %v", v.CoveredBy)
			}
		}
		inv, _ := (&actions{s: a.server}).Inventory(context.Background())
		for _, st := range inv.Stacks {
			if st.Stack == "shop" && st.Env == env && strings.Join(st.NotBackedUp, ",") != "cachedata" {
				t.Fatalf("inventory notBackedUp = %v", st.NotBackedUp)
			}
		}
	})

	t.Run("the schedule takes service members, and a stopped stack is skipped, not failed", func(t *testing.T) {
		a.runDueBackups(context.Background(), time.Hour)
		if m := member("broken"); !strings.Contains(m.LastBackupError, "wrote nothing") {
			t.Fatalf("broken = %+v", m)
		}
		if err := a.stopStack("shop", env); err != nil {
			t.Fatal(err)
		}
		before := member("files").LastBackupError
		_, err := a.backupInstance(context.Background(), member("files"))
		var refused backupRefused
		if err == nil || !asRefusal(err, &refused) || member("files").LastBackupError != before {
			t.Fatalf("err = %v, error = %q", err, member("files").LastBackupError)
		}
	})
}

func TestRestoreKey(t *testing.T) {
	t.Run("a file name resolves under the service's own prefix", func(t *testing.T) {
		key, err := restoreKey("shop", "staging", "db", "20261024T120000Z.dump.gz", "")
		if err != nil || key != "apps/shop.db-staging/db/20261024T120000Z.dump.gz" {
			t.Fatalf("%q %v", key, err)
		}
	})
	t.Run("another environment's backup needs --from naming it", func(t *testing.T) {
		prod := "apps/shop.db-production/db/20261024T120000Z.dump.gz"
		if _, err := restoreKey("shop", "staging", "db", prod, ""); err == nil || !strings.Contains(err.Error(), "--from") {
			t.Fatalf("err = %v", err)
		}
		if key, err := restoreKey("shop", "staging", "db", prod, "shop/production"); err != nil || key != prod {
			t.Fatalf("%q %v", key, err)
		}
		if _, err := restoreKey("shop", "staging", "db", prod, "shop/qa"); err == nil {
			t.Fatal("a --from naming a different environment was accepted")
		}
	})
	t.Run("a SQLite snapshot or a path escape is refused", func(t *testing.T) {
		for _, b := range []string{"20261024T120000Z.sqlite.gz", "apps/shop.db-staging/db/x/../y.dump.gz"} {
			if _, err := restoreKey("shop", "staging", "db", b, ""); err == nil {
				t.Fatalf("%s accepted", b)
			}
		}
	})
}

func TestServiceRestoreDaemon(t *testing.T) {
	d := daemonDocker(t)
	requireComposeCLI(t)
	a := newAcceptanceServer(t, d)
	srv := s3test.New(t)
	if err := a.store.SetS3(&state.S3Config{S3Target: state.S3Target{Endpoint: srv.URL, Bucket: srv.Bucket,
		AccessKey: "AK", SecretKey: "SK", Region: "auto"}, Keep: 5}); err != nil {
		t.Fatal(err)
	}
	suffix := strconv.FormatInt(time.Now().UnixNano()%1e9, 36)
	prod, staging := "pr"+suffix, "sg"+suffix
	for _, env := range []string{prod, staging} {
		t.Cleanup(func() { a.purge("shop", env) })
		if _, err := a.deployStack(context.Background(), stackDeployOptions{Stack: "shop", Env: env,
			Bundle: tarGz(t, t.TempDir(), "r.tar.gz", map[string]string{"compose.yml": backedUpCompose("true")})}); err != nil {
			t.Fatal(err)
		}
	}
	psql := func(env, sql string) string {
		out, err := exec.Command("docker", "exec", runner.ContainerName(memberKey("shop", env, "db")),
			"psql", "-U", "app", "-d", "app", "-tAc", sql).CombinedOutput()
		if err != nil {
			t.Fatalf("psql %s: %v %s", sql, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	restore := func(env, service, backup, from, confirm string) *httptest.ResponseRecorder {
		q := neturl.Values{"service": {service}, "backup": {backup}, "confirm": {confirm}}
		if from != "" {
			q.Set("from", from)
		}
		rec := httptest.NewRecorder()
		a.controlMux().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/stacks/shop/"+env+"/restore?"+q.Encode(), nil))
		return rec
	}
	psql(prod, "create table kept (v text); insert into kept values ('before')")
	out, err := a.backupInstance(context.Background(), storeGet(t, a.store, memberKey("shop", prod, "db")))
	if err != nil {
		t.Fatal(err)
	}
	backup := path.Base(out.Result.Key)
	psql(prod, "update kept set v = 'after'")

	t.Run("bay backup list shows each service's dumps", func(t *testing.T) {
		rec := httptest.NewRecorder()
		a.controlMux().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/stacks/shop/"+prod+"/backups?service=db", nil))
		if rec.Code != 200 || !strings.Contains(rec.Body.String(), backup) {
			t.Fatalf("%d %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("a restore must name what it overwrites", func(t *testing.T) {
		if rec := restore(prod, "db", backup, "", "shop/"+prod); rec.Code != http.StatusPreconditionRequired {
			t.Fatalf("%d %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("a postgres dump replays into its service", func(t *testing.T) {
		if rec := restore(prod, "db", backup, "", "shop/"+prod+"/db"); rec.Code != 200 {
			t.Fatalf("%d %s", rec.Code, rec.Body.String())
		}
		if v := psql(prod, "select v from kept"); v != "before" {
			t.Fatalf("kept = %q", v)
		}
	})

	t.Run("production's dump goes into staging only with --from", func(t *testing.T) {
		full := out.Result.Key
		if rec := restore(staging, "db", full, "", "shop/"+staging+"/db"); rec.Code != 400 || !strings.Contains(rec.Body.String(), "--from") {
			t.Fatalf("%d %s", rec.Code, rec.Body.String())
		}
		if rec := restore(staging, "db", full, "shop/"+prod, "shop/"+staging+"/db"); rec.Code != 200 {
			t.Fatalf("%d %s", rec.Code, rec.Body.String())
		}
		if v := psql(staging, "select v from kept"); v != "before" {
			t.Fatalf("staging kept = %q", v)
		}
	})

	t.Run("a command hook replays through its restore command", func(t *testing.T) {
		files := runner.ContainerName(memberKey("shop", prod, "files"))
		dumped, err := a.backupInstance(context.Background(), storeGet(t, a.store, memberKey("shop", prod, "files")))
		if err != nil {
			t.Fatal(err)
		}
		_ = exec.Command("docker", "exec", files, "sh", "-c", "echo changed > /data/note").Run()
		if rec := restore(prod, "files", path.Base(dumped.Result.Key), "", "shop/"+prod+"/files"); rec.Code != 200 {
			t.Fatalf("%d %s", rec.Code, rec.Body.String())
		}
		got, _ := exec.Command("docker", "exec", files, "cat", "/data/note").Output()
		if strings.TrimSpace(string(got)) != "kept" {
			t.Fatalf("note = %q", got)
		}
	})

	t.Run("a hook without a restore command is refused", func(t *testing.T) {
		if rec := restore(prod, "broken", "x.dump.gz", "", "shop/"+prod+"/broken"); rec.Code != http.StatusPreconditionFailed {
			t.Fatalf("%d %s", rec.Code, rec.Body.String())
		}
	})
}

func storeGet(t *testing.T, store *state.Store, key string) state.App {
	t.Helper()
	m, ok := store.Get(key)
	if !ok {
		t.Fatalf("no %s", key)
	}
	return m
}
