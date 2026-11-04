package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/s3/s3test"
	"github.com/alepha-dev/bay/internal/state"
)

func (f *deployFixture) restore(t *testing.T, key string) *httptest.ResponseRecorder {
	t.Helper()
	target := "/apps/demo/production/restore?confirm=yes"
	if key != "" {
		target += "&key=" + url.QueryEscape(key)
	}
	req := httptest.NewRequest(http.MethodPost, target, nil)
	req.SetPathValue("name", "demo")
	req.SetPathValue("env", "production")
	rec := httptest.NewRecorder()
	f.server.handleRestore(rec, req)
	return rec
}

func bundleFixture(t *testing.T) (*deployFixture, *s3test.Server, string) {
	t.Helper()
	f := newBackupFixture(t)
	srv := s3test.New(t)
	if err := f.server.store.SetS3(&state.S3Config{S3Target: state.S3Target{
		Endpoint: srv.URL, Bucket: srv.Bucket, AccessKey: "AK", SecretKey: "SK", Region: "auto"}, Keep: 7}); err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(f.root, "apps", naming.Instance("demo", "production"), "data")
	writeFile(t, filepath.Join(data, "queue", "jobs.db"), "SQLite format 3\x00queue as backed up")
	return f, srv, data
}

func writeFile(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// Every database of data/ is backed up together, and comes back together.
func TestBackupAndRestoreEveryDatabaseOfData(t *testing.T) {
	f, srv, data := bundleFixture(t)

	rec := f.backup(t)
	if rec.Code != http.StatusOK {
		t.Fatalf("backup: %d %s", rec.Code, rec.Body)
	}
	var out struct {
		Key   string   `json:"key"`
		Kind  string   `json:"kind"`
		Files []string `json:"files"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Kind != "bundle" || strings.Join(out.Files, ",") != "app.db,queue/jobs.db" || !strings.HasSuffix(out.Key, "/manifest.json") {
		t.Fatalf("backup answered %+v", out)
	}
	if _, ok := srv.Object(strings.TrimSuffix(out.Key, "manifest.json") + "files/queue/jobs.db.gz"); !ok {
		t.Fatalf("the second database is not in the bucket: %v", srv.Keys())
	}
	if f.app(t).LastBackupKey != out.Key {
		t.Fatalf("the recorded backup is %q, want the manifest", f.app(t).LastBackupKey)
	}

	writeFile(t, filepath.Join(data, "queue", "jobs.db"), "SQLite format 3\x00queue changed since")
	rec = f.restore(t, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body)
	}
	got, _ := os.ReadFile(filepath.Join(data, "queue", "jobs.db"))
	if string(got) != "SQLite format 3\x00queue as backed up" {
		t.Fatalf("queue/jobs.db reads %q after the restore", got)
	}
	if !f.runner.Running("demo/production") {
		t.Fatal("the app must be running again after a restore")
	}
}

// A bucket filled before bundles keeps every backup it has.
func TestOlderSingleFileBackupStillRestores(t *testing.T) {
	f, srv, data := bundleFixture(t)
	var packed bytes.Buffer
	gz := gzip.NewWriter(&packed)
	_, _ = gz.Write([]byte("SQLite format 3\x00the older app.db"))
	_ = gz.Close()
	key := "apps/demo-production/db/20200101T000000Z.sqlite.gz"
	srv.Seed(key, packed.Bytes())

	req := httptest.NewRequest(http.MethodGet, "/apps/demo/production/backups", nil)
	req.SetPathValue("name", "demo")
	req.SetPathValue("env", "production")
	list := httptest.NewRecorder()
	f.server.handleListBackups(list, req)
	var entries []map[string]any
	if err := json.Unmarshal(list.Body.Bytes(), &entries); err != nil || len(entries) != 1 || entries[0]["kind"] != "sqlite" {
		t.Fatalf("listing %s", list.Body)
	}

	rec := f.restore(t, key)
	if rec.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body)
	}
	got, _ := os.ReadFile(filepath.Join(data, "app.db"))
	if string(got) != "SQLite format 3\x00the older app.db" {
		t.Fatalf("app.db reads %q", got)
	}
}

// Two apps may share a bucket; a pasted key must not restore one into the other.
func TestRestoreRefusesAnotherAppsBackup(t *testing.T) {
	f, srv, _ := bundleFixture(t)
	srv.Seed("apps/shop-production/db/20200101T000000Z.sqlite.gz", []byte("x"))
	rec := f.restore(t, "apps/shop-production/db/20200101T000000Z.sqlite.gz")
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "not a backup of demo/production") {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	if !f.runner.Running("demo/production") {
		t.Fatal("a refused restore must not touch the app")
	}
}
