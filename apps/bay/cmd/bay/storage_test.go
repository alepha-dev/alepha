package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/alepha/bay/internal/runner"
	"github.com/alepha/bay/internal/state"
)

// rejectingS3 answers 403 to everything, the way a wrong key does.
func rejectingS3(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func configStorage(t *testing.T, f *deployFixture, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/config/storage", strings.NewReader(body))
	rec := httptest.NewRecorder()
	f.server.handleConfigStorage(rec, req)
	return rec
}

// The credential handed to apps must be configured separately from the one that
// can delete backups — see state.State.Storage.
func TestConfigStorageIsSeparateFromBackups(t *testing.T) {
	f := newDeployFixture(t)
	blobs := fakeS3(t)

	rec := configStorage(t, f, `{
		"endpoint": "`+blobs.URL+`",
		"bucket": "bay-blobs",
		"accessKey": "blob-access",
		"secretKey": "blob-secret"
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body)
	}

	stored := f.server.store.Storage()
	if stored == nil {
		t.Fatal("storage config was not persisted")
	}
	if stored.Bucket != "bay-blobs" || stored.AccessKey != "blob-access" {
		t.Fatalf("config not stored as given: %+v", stored)
	}
	// Region is what R2 wants and what nobody remembers to pass.
	if stored.Region != "auto" {
		t.Fatalf("region should default to auto, got %q", stored.Region)
	}
	// Configuring blob storage must not invent a backup destination.
	if f.server.store.S3() != nil {
		t.Fatal("configuring storage must not configure backups")
	}
}

// A credential that only fails at the first upload fails inside someone's app,
// long after the operator has moved on. Prove it now.
func TestConfigStorageRefusesCredentialsTheBucketRejects(t *testing.T) {
	f := newDeployFixture(t)
	bad := rejectingS3(t)

	rec := configStorage(t, f, `{
		"endpoint": "`+bad.URL+`",
		"bucket": "bay-blobs",
		"accessKey": "wrong",
		"secretKey": "wrong"
	}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a bucket that refuses us, got %d: %s", rec.Code, rec.Body)
	}
	if f.server.store.Storage() != nil {
		t.Fatal("a rejected config must not be persisted")
	}
}

func TestConfigStorageRequiresEveryField(t *testing.T) {
	f := newDeployFixture(t)
	rec := configStorage(t, f, `{"endpoint": "https://example.test", "bucket": "b"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing credentials, got %d", rec.Code)
	}
	if f.server.store.Storage() != nil {
		t.Fatal("an incomplete config must not be persisted")
	}
}

// Write-only, like the backup config: a session that can call the API must not
// be able to read credentials back out of it.
func TestGetConfigStorageNeverEchoesTheSecret(t *testing.T) {
	f := newDeployFixture(t)
	blobs := fakeS3(t)
	if err := f.server.store.SetStorage(&state.S3Target{
		Endpoint: blobs.URL, Bucket: "bay-blobs",
		AccessKey: "blob-access", SecretKey: "super-secret", Region: "auto",
	}); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/config/storage", nil)
	rec := httptest.NewRecorder()
	f.server.handleGetConfigStorage(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "super-secret") {
		t.Fatalf("the secret was echoed back: %s", rec.Body)
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["configured"] != true || got["bucket"] != "bay-blobs" {
		t.Fatalf("unexpected payload: %v", got)
	}
}

// bucketDeployableArtifact is deployableArtifact plus a declared bucket, which
// is what asks Bay for somewhere to put blobs.
func bucketDeployableArtifact(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "artifact.tar.gz")
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	files := map[string]string{
		"dist/manifest.json": `{
			"project": "demo",
			"entry": "index.js",
			"runtime": "node",
			"runtimeVersion": "24",
			"resources": { "hasBucket": true }
		}`,
		"dist/index.js": "process.exit(0)",
	}
	for name, body := range files {
		hdr := &tar.Header{Name: name, Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(body))}
		if err := tw.WriteHeader(hdr); err != nil {
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
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

// Spec.Sandbox is `any` so a backend can carry its own settings; the systemd
// one is what decides writable paths.
func grantsStorageDir(t *testing.T, spec runner.Spec) bool {
	t.Helper()
	sandbox, ok := spec.Sandbox.(runner.Sandbox)
	if !ok {
		t.Fatalf("expected a runner.Sandbox, got %T", spec.Sandbox)
	}
	for _, p := range sandbox.WritablePaths {
		if strings.HasSuffix(p, string(filepath.Separator)+"storage") {
			return true
		}
	}
	return false
}

// An app that writes its blobs to a bucket has no reason to hold a writable
// directory. Under ProtectSystem=strict, not granting it is what makes that
// real rather than a convention.
func TestS3BackedAppIsNotGrantedALocalStorageDirectory(t *testing.T) {
	f := newDeployFixture(t)
	blobs := fakeS3(t)
	if err := f.server.store.SetStorage(&state.S3Target{
		Endpoint: blobs.URL, Bucket: "bay-blobs",
		AccessKey: "a", SecretKey: "b", Region: "auto",
	}); err != nil {
		t.Fatal(err)
	}

	if _, failure := f.server.deployArtifact(context.Background(), deployArtifactOptions{
		Artifact: bucketDeployableArtifact(t), Name: "demo", Env: "production",
	}); failure != nil {
		t.Fatalf("deploy failed: %v", failure)
	}

	if grantsStorageDir(t, f.runner.lastSpec) {
		t.Fatalf("an S3-backed app must not be granted storage/: %v",
			f.runner.lastSpec.Sandbox)
	}
}

// The local case must keep working exactly as before: declaring a bucket is
// what grants write access to storage/.
func TestLocalAppKeepsItsStorageDirectory(t *testing.T) {
	f := newDeployFixture(t)

	if _, failure := f.server.deployArtifact(context.Background(), deployArtifactOptions{
		Artifact: bucketDeployableArtifact(t), Name: "demo", Env: "production",
	}); failure != nil {
		t.Fatalf("deploy failed: %v", failure)
	}

	if !grantsStorageDir(t, f.runner.lastSpec) {
		t.Fatalf("a local app still needs storage/: %v",
			f.runner.lastSpec.Sandbox)
	}
}

// localBackedBackupFixture is a deployed blob-using app whose blobs are on this
// disk, with somewhere to back its database up to.
func localBackedBackupFixture(t *testing.T, puts *[]string) *deployFixture {
	t.Helper()
	f := newDeployFixture(t)

	backups := recordingS3(t, puts)
	if _, failure := f.server.deployArtifact(context.Background(), deployArtifactOptions{
		Artifact: bucketDeployableArtifact(t), Name: "demo", Env: "production",
	}); failure != nil {
		t.Fatalf("deploy failed: %v", failure)
	}
	snapshotCapableNode(t, filepath.Join(f.root, "runtimes", "node-24", "bin", "node"))

	// Real uploads on disk, so "nothing was archived" cannot pass by accident.
	uploads := filepath.Join(f.root, "apps", "demo", "production", "storage", "avatars")
	if err := os.MkdirAll(uploads, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(uploads, "a.png"), []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}

	dataDir := filepath.Join(f.root, "apps", "demo", "production", "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "app.db"),
		[]byte("SQLite format 3\x00"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := f.server.store.SetS3(&state.S3Config{
		S3Target: state.S3Target{
			Endpoint: backups.URL, Bucket: "backups",
			AccessKey: "key", SecretKey: "secret", Region: "auto",
		},
		Keep: 7,
	}); err != nil {
		t.Fatal(err)
	}
	return f
}

// recordingS3 is fakeS3 that remembers which keys were written to it.
func recordingS3(t *testing.T, puts *[]string) *httptest.Server {
	t.Helper()
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/xml")
			_, _ = w.Write([]byte(
				`<?xml version="1.0" encoding="UTF-8"?>` +
					`<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>`))
			return
		}
		if r.Method == http.MethodPut {
			mu.Lock()
			*puts = append(*puts, r.URL.Path)
			mu.Unlock()
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// s3BackedBackupFixture is a deployed blob-using app whose blobs live in the
// bucket, with somewhere to back its database up to.
func s3BackedBackupFixture(t *testing.T, puts *[]string) *deployFixture {
	t.Helper()
	f := newDeployFixture(t)

	blobs := recordingS3(t, puts)
	if err := f.server.store.SetStorage(&state.S3Target{
		Endpoint: blobs.URL, Bucket: "bay-blobs",
		AccessKey: "a", SecretKey: "b", Region: "auto",
	}); err != nil {
		t.Fatal(err)
	}
	if _, failure := f.server.deployArtifact(context.Background(), deployArtifactOptions{
		Artifact: bucketDeployableArtifact(t), Name: "demo", Env: "production",
	}); failure != nil {
		t.Fatalf("deploy failed: %v", failure)
	}
	snapshotCapableNode(t, filepath.Join(f.root, "runtimes", "node-24", "bin", "node"))

	// Leftovers on disk, so the skip is genuinely exercised. Without them the
	// tar finds nothing and "no storage key was uploaded" would pass whether or
	// not anything skips it — a green test proving nothing.
	//
	// Realistic, too: this is what an app looks like the day after it moved to
	// the bucket, before anyone cleaned the old directory up.
	leftovers := filepath.Join(f.root, "apps", "demo", "production", "storage", "avatars")
	if err := os.MkdirAll(leftovers, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(leftovers, "old.png"), []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}

	dataDir := filepath.Join(f.root, "apps", "demo", "production", "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "app.db"),
		[]byte("SQLite format 3\x00"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := f.server.store.SetS3(&state.S3Config{
		S3Target: state.S3Target{
			Endpoint: blobs.URL, Bucket: "backups",
			AccessKey: "key", SecretKey: "secret", Region: "auto",
		},
		Keep: 7,
	}); err != nil {
		t.Fatal(err)
	}
	return f
}

// notBackedUpOf reads the disclosure list off a backup response.
func notBackedUpOf(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	items, _ := body["notBackedUp"].([]any)
	var joined string
	for _, item := range items {
		joined += item.(string) + "\n"
	}
	return joined
}

// Bay backs up the database and nothing else.
//
// `storage/` used to be tarred nightly, which sounded like protection and was
// not: nothing could ever restore it (`bay restore` says so itself), `Prune`
// only ever walked the `db/` prefix so the archives grew without bound, and
// `ListStorage` had no callers. A one-directional, unprunable copy capped at
// 1 GiB of RAM.
//
// So blobs are shared through S3 or they are not shared at all — and either
// way the response says which, because a backup that quietly covers less than
// it did yesterday is the worst thing this system can produce.
func TestBackupNeverArchivesUploads(t *testing.T) {
	t.Run("S3-backed app", func(t *testing.T) {
		var puts []string
		f := s3BackedBackupFixture(t, &puts)

		rec := f.backup(t)
		if rec.Code != http.StatusOK {
			t.Fatalf("backup failed: %s", rec.Body)
		}
		for _, key := range puts {
			if strings.Contains(key, "/storage/") {
				t.Fatalf("no app may have its storage tarred: %v", puts)
			}
		}

		joined := notBackedUpOf(t, rec)
		if !strings.Contains(joined, "storage/") {
			t.Fatalf("the response must state that storage/ is not archived, got %q", joined)
		}
		// Not "unprotected" — the blobs are in a bucket, which is a different
		// claim from "not covered", and the operator needs to know which.
		if !strings.Contains(joined, "bay-blobs") {
			t.Fatalf("the response should name where the blobs actually live, got %q", joined)
		}
	})

	t.Run("local app", func(t *testing.T) {
		var puts []string
		f := localBackedBackupFixture(t, &puts)

		rec := f.backup(t)
		if rec.Code != http.StatusOK {
			t.Fatalf("backup failed: %s", rec.Body)
		}
		for _, key := range puts {
			if strings.Contains(key, "/storage/") {
				t.Fatalf("a local app's uploads must not be archived either: %v", puts)
			}
		}

		joined := notBackedUpOf(t, rec)
		if !strings.Contains(joined, "storage/") {
			t.Fatalf("the response must state that storage/ is not archived, got %q", joined)
		}
		// This app's files exist in exactly one place, on this disk. Saying so
		// is the whole point: an operator who wants them elsewhere has to
		// configure a bucket, and cannot learn that from silence.
		if !strings.Contains(joined, "bay config s3:apps") {
			t.Fatalf("a local app must be told how to get its uploads off this disk, got %q", joined)
		}
	})
}

// localAppWithUploads is a deployed blob-using app holding files on disk — the
// state every existing Bay app is in before it moves to a bucket.
func localAppWithUploads(t *testing.T) *deployFixture {
	t.Helper()
	f := newDeployFixture(t)
	if _, failure := f.server.deployArtifact(context.Background(), deployArtifactOptions{
		Artifact: bucketDeployableArtifact(t), Name: "demo", Env: "production",
	}); failure != nil {
		t.Fatalf("deploy failed: %v", failure)
	}
	storageDir := filepath.Join(f.root, "apps", "demo", "production", "storage")
	for _, rel := range []string{"avatars/a.png", "avatars/b.png", "invoices/2026/x.pdf"} {
		full := filepath.Join(storageDir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("body-of-"+rel), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return f
}

func migrateStorage(t *testing.T, f *deployFixture) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/apps/demo/production/storage/migrate", nil)
	req.SetPathValue("name", "demo")
	req.SetPathValue("env", "production")
	rec := httptest.NewRecorder()
	f.server.handleMigrateStorage(rec, req)
	return rec
}

func TestMigrateCopiesEveryFileUnderTheAppPrefix(t *testing.T) {
	f := localAppWithUploads(t)
	var puts []string
	blobs := recordingS3(t, &puts)
	if err := f.server.store.SetStorage(&state.S3Target{
		Endpoint: blobs.URL, Bucket: "bay-blobs",
		AccessKey: "a", SecretKey: "b", Region: "auto",
	}); err != nil {
		t.Fatal(err)
	}

	rec := migrateStorage(t, f)
	if rec.Code != http.StatusOK {
		t.Fatalf("migrate failed: %s", rec.Body)
	}

	// The relative path is the key. The local provider writes
	// `<root>/<tenantId?>/<container>/<fileId>` and the S3 provider keys
	// `<prefix>/<tenantId?>/<container>/<fileId>` — the same shape, so
	// preserving the relative path is the whole mapping.
	for _, want := range []string{
		"/bay-blobs/apps/demo/production/blobs/avatars/a.png",
		"/bay-blobs/apps/demo/production/blobs/avatars/b.png",
		"/bay-blobs/apps/demo/production/blobs/invoices/2026/x.pdf",
	} {
		found := false
		for _, got := range puts {
			if got == want {
				found = true
			}
		}
		if !found {
			t.Errorf("missing upload %q, got %v", want, puts)
		}
	}
}

func TestMigrateSwitchesTheAppOver(t *testing.T) {
	f := localAppWithUploads(t)
	var puts []string
	blobs := recordingS3(t, &puts)
	if err := f.server.store.SetStorage(&state.S3Target{
		Endpoint: blobs.URL, Bucket: "bay-blobs",
		AccessKey: "a", SecretKey: "b", Region: "auto",
	}); err != nil {
		t.Fatal(err)
	}

	if rec := migrateStorage(t, f); rec.Code != http.StatusOK {
		t.Fatalf("migrate failed: %s", rec.Body)
	}

	app, _ := f.server.store.Get("demo/production")
	if app.StorageBackend != "s3" {
		t.Fatalf("expected the app to be on s3, got %q", app.StorageBackend)
	}
	raw, err := os.ReadFile(filepath.Join(f.root, "apps", "demo", "production", ".env"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "S3_KEY_PREFIX=apps/demo/production/blobs") {
		t.Fatalf("the app was not repointed at the bucket:\n%s", raw)
	}
	if strings.Contains(string(raw), "STORAGE_PATH=") {
		t.Fatalf("STORAGE_PATH must be gone once blobs are in the bucket:\n%s", raw)
	}
}

// Copy, then let a human delete. A command that removes the only other copy of
// the data in the same breath as writing it is one bug away from losing it.
func TestMigrateLeavesTheLocalFilesAlone(t *testing.T) {
	f := localAppWithUploads(t)
	var puts []string
	blobs := recordingS3(t, &puts)
	if err := f.server.store.SetStorage(&state.S3Target{
		Endpoint: blobs.URL, Bucket: "bay-blobs",
		AccessKey: "a", SecretKey: "b", Region: "auto",
	}); err != nil {
		t.Fatal(err)
	}

	if rec := migrateStorage(t, f); rec.Code != http.StatusOK {
		t.Fatalf("migrate failed: %s", rec.Body)
	}

	original := filepath.Join(f.root, "apps", "demo", "production", "storage", "avatars", "a.png")
	if _, err := os.Stat(original); err != nil {
		t.Fatalf("the local copy must survive the migration: %v", err)
	}
}

// And afterwards the deploy that was refused must go through.
func TestMigrateUnblocksTheNextDeploy(t *testing.T) {
	f := localAppWithUploads(t)
	var puts []string
	blobs := recordingS3(t, &puts)
	if err := f.server.store.SetStorage(&state.S3Target{
		Endpoint: blobs.URL, Bucket: "bay-blobs",
		AccessKey: "a", SecretKey: "b", Region: "auto",
	}); err != nil {
		t.Fatal(err)
	}

	// Refused before migrating — this is the guard doing its job.
	if _, failure := f.server.deployArtifact(context.Background(), deployArtifactOptions{
		Artifact: bucketDeployableArtifact(t), Name: "demo", Env: "production",
	}); failure == nil {
		t.Fatal("a deploy that would strand files must be refused")
	}

	if rec := migrateStorage(t, f); rec.Code != http.StatusOK {
		t.Fatalf("migrate failed: %s", rec.Body)
	}

	if _, failure := f.server.deployArtifact(context.Background(), deployArtifactOptions{
		Artifact: bucketDeployableArtifact(t), Name: "demo", Env: "production",
	}); failure != nil {
		t.Fatalf("after migrating, the deploy must go through: %v", failure)
	}
}

func TestMigrateRefusesWithoutSomewhereToPutTheFiles(t *testing.T) {
	f := localAppWithUploads(t)
	rec := migrateStorage(t, f)
	if rec.Code != http.StatusPreconditionFailed {
		t.Fatalf("expected 412 with no storage configured, got %d: %s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), "bay config s3:apps") {
		t.Fatalf("the refusal must name the fix, got: %s", rec.Body)
	}
}

func TestGetConfigStorageReportsUnconfigured(t *testing.T) {
	f := newDeployFixture(t)
	req := httptest.NewRequest(http.MethodGet, "/config/storage", nil)
	rec := httptest.NewRecorder()
	f.server.handleGetConfigStorage(rec, req)

	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["configured"] != false {
		t.Fatalf("expected configured:false, got %v", got)
	}
}

// `s3` vs `storage` named the technology twice and the consumer never — both
// ARE S3, and which is which was learnable only by reading the source. The
// subcommands name the consumer instead.
//
// `bay config s3` still exists and sets BOTH from one credential. That is the
// convenient path and the less safe one: an app handed a key that also reaches
// the backup bucket can delete its own backups. Allowed, because a one-operator
// fleet should not need two tokens to get started — but never silent.
func TestSharedCredentialIsReportedAsShared(t *testing.T) {
	f := newDeployFixture(t)
	blobs := fakeS3(t)

	if err := f.server.store.SetS3(&state.S3Config{
		S3Target: state.S3Target{
			Endpoint: blobs.URL, Bucket: "one-bucket",
			AccessKey: "same-key", SecretKey: "same-secret", Region: "auto",
		},
		Keep: 7,
	}); err != nil {
		t.Fatal(err)
	}
	if err := f.server.store.SetStorage(&state.S3Target{
		Endpoint: blobs.URL, Bucket: "one-bucket",
		AccessKey: "same-key", SecretKey: "same-secret", Region: "auto",
	}); err != nil {
		t.Fatal(err)
	}

	if !f.server.store.CredentialsShared() {
		t.Fatal("identical app and backup credentials must be reported as shared")
	}
}

func TestSeparateCredentialsAreNotReportedAsShared(t *testing.T) {
	f := newDeployFixture(t)
	blobs := fakeS3(t)

	if err := f.server.store.SetS3(&state.S3Config{
		S3Target: state.S3Target{
			Endpoint: blobs.URL, Bucket: "backups",
			AccessKey: "backup-key", SecretKey: "backup-secret", Region: "auto",
		},
		Keep: 7,
	}); err != nil {
		t.Fatal(err)
	}
	if err := f.server.store.SetStorage(&state.S3Target{
		Endpoint: blobs.URL, Bucket: "blobs",
		AccessKey: "blob-key", SecretKey: "blob-secret", Region: "auto",
	}); err != nil {
		t.Fatal(err)
	}

	if f.server.store.CredentialsShared() {
		t.Fatal("two distinct secrets must not be reported as shared")
	}
}

// Sharing is only interesting once both halves exist.
func TestBackupsAloneAreNotShared(t *testing.T) {
	f := newDeployFixture(t)
	blobs := fakeS3(t)
	if err := f.server.store.SetS3(&state.S3Config{
		S3Target: state.S3Target{
			Endpoint: blobs.URL, Bucket: "backups",
			AccessKey: "k", SecretKey: "s", Region: "auto",
		},
	}); err != nil {
		t.Fatal(err)
	}
	if f.server.store.CredentialsShared() {
		t.Fatal("with no app storage configured nothing is shared")
	}
}
