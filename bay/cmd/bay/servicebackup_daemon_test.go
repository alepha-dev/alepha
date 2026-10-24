package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

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
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
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
volumes:
  pgdata:
  filedata:
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
