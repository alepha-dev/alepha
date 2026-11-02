package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/state"
)

// memoryS3 is a bucket that remembers: PUT stores, GET lists, DELETE removes
// and is recorded. The point of these tests is what retention deletes, so the
// empty-listing `fakeS3` cannot answer it.
type memoryS3 struct {
	mu      sync.Mutex
	objects map[string]int
	deleted []string
	srv     *httptest.Server
}

func newMemoryS3(t *testing.T, keys ...string) *memoryS3 {
	t.Helper()
	m := &memoryS3{objects: map[string]int{}}
	for _, k := range keys {
		m.objects[k] = 1
	}
	m.srv = httptest.NewServer(withHead(func(w http.ResponseWriter, r *http.Request) {
		m.mu.Lock()
		defer m.mu.Unlock()
		key := strings.TrimPrefix(r.URL.Path, "/backups/")
		switch r.Method {
		case http.MethodPut:
			m.objects[key] = 1
		case http.MethodDelete:
			delete(m.objects, key)
			m.deleted = append(m.deleted, key)
			w.WriteHeader(http.StatusNoContent)
		case http.MethodGet:
			prefix := r.URL.Query().Get("prefix")
			var b strings.Builder
			b.WriteString(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>false</IsTruncated>`)
			names := make([]string, 0, len(m.objects))
			for k := range m.objects {
				if strings.HasPrefix(k, prefix) {
					names = append(names, k)
				}
			}
			sort.Strings(names)
			for _, k := range names {
				b.WriteString("<Contents><Key>" + k + "</Key><Size>1</Size></Contents>")
			}
			b.WriteString("</ListBucketResult>")
			w.Header().Set("Content-Type", "application/xml")
			_, _ = w.Write([]byte(b.String()))
		}
	}))
	t.Cleanup(m.srv.Close)
	return m
}

func (m *memoryS3) deletedKeys() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]string(nil), m.deleted...)
}

// pointAt swaps the fixture's bucket, keeping one backup per run.
func pointAt(t *testing.T, f *deployFixture, endpoint string) {
	t.Helper()
	if err := f.server.store.SetS3(&state.S3Config{
		S3Target: state.S3Target{Endpoint: endpoint, Bucket: "backups", AccessKey: "key", SecretKey: "secret", Region: "auto"},
		Keep:     1,
	}); err != nil {
		t.Fatal(err)
	}
}

// Backups of the real data, taken long before the empty database appeared.
var oldBackups = []string{
	"apps/demo-production/db/20200101T000000Z.sqlite.gz",
	"apps/demo-production/db/20200102T000000Z.sqlite.gz",
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v\n%s", err, rec.Body.String())
	}
	return body
}

// The bug this pins: a deploy that could not reach the bucket started the
// app on an empty database and said only "empty (could not reach the
// bucket)". The scheduler then backed up the empty database every day and
// `keep N` deleted the real backups N days later, without anyone deciding to.
func TestAutoRestoreThatCouldNotCheckMarksTheInstancePending(t *testing.T) {
	f := newBackupFixture(t)
	down := httptest.NewServer(http.NotFoundHandler())
	down.Close()
	pointAt(t, f, down.URL)

	out := f.server.maybeAutoRestore(context.Background(), f.app(t), "/nonexistent/app.db")

	if out["restorePending"] != true {
		t.Fatalf("the deploy response must say a restore is pending, got %v", out)
	}
	p := f.app(t).RestorePending
	if p == nil || p.Reason != "could not reach the bucket" || p.Since == "" {
		t.Fatalf("the instance must be marked pending with its reason, got %+v", p)
	}
}

func TestAutoRestoreWithNoDestinationMarksItPending(t *testing.T) {
	f := newBackupFixture(t)
	if err := f.server.store.SetS3(nil); err != nil {
		t.Fatal(err)
	}
	if mgr, _, _ := f.server.backupManager(); mgr != nil {
		t.Skip("clearing the destination is not supported by this store")
	}

	f.server.maybeAutoRestore(context.Background(), f.app(t), "/nonexistent/app.db")

	if p := f.app(t).RestorePending; p == nil || p.Reason != "no backup destination configured" {
		t.Fatalf("a bucket configured after the first deploy may hold the old backups: want pending, got %+v", p)
	}
}

// Checked and found nothing: a new app, nothing to protect.
func TestAutoRestoreThatFoundNoBackupIsNotPending(t *testing.T) {
	f := newBackupFixture(t)
	if err := f.server.store.SetRestorePending("demo/production", "earlier", time.Now()); err != nil {
		t.Fatal(err)
	}

	out := f.server.maybeAutoRestore(context.Background(), f.app(t), "/nonexistent/app.db")

	if out["restorePending"] != nil {
		t.Fatalf("no backup found is a checked answer, not a pending one: %v", out)
	}
	if p := f.app(t).RestorePending; p != nil {
		t.Fatalf("a check that found nothing must clear the guard, got %+v", p)
	}
}

func TestPendingRestoreSuspendsPruningWhileOlderBackupsExist(t *testing.T) {
	f := newBackupFixture(t)
	bucket := newMemoryS3(t, oldBackups...)
	pointAt(t, f, bucket.srv.URL)
	if err := f.server.store.SetRestorePending("demo/production", "could not reach the bucket", time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}

	rec := f.backup(t)
	if rec.Code != http.StatusOK {
		t.Fatalf("the backup itself must still run (it protects the new data): %d %s", rec.Code, rec.Body.String())
	}

	if got := bucket.deletedKeys(); len(got) != 0 {
		t.Fatalf("keep=1 must not delete the backups that predate the empty database, deleted %v", got)
	}
	body := decode(t, rec)
	if s, _ := body["pruneSuspended"].(string); !strings.Contains(s, "2 older backup(s) kept") {
		t.Fatalf("the response must say why nothing was pruned, got %v", body["pruneSuspended"])
	}
	if f.app(t).RestorePending == nil {
		t.Fatal("the guard must stay until someone restores or dismisses")
	}
}

// The control: without the guard, keep=1 does delete them. Without this, the
// test above could pass because retention never ran at all.
func TestWithoutPendingRestorePruningRuns(t *testing.T) {
	f := newBackupFixture(t)
	bucket := newMemoryS3(t, oldBackups...)
	pointAt(t, f, bucket.srv.URL)

	if rec := f.backup(t); rec.Code != http.StatusOK {
		t.Fatalf("backup: %d %s", rec.Code, rec.Body.String())
	}
	if got := bucket.deletedKeys(); len(got) != len(oldBackups) {
		t.Fatalf("keep=1 should have removed both old backups, deleted %v", got)
	}
}

func TestPendingRestoreLiftsItselfWhenNothingPredatesIt(t *testing.T) {
	f := newBackupFixture(t)
	bucket := newMemoryS3(t)
	pointAt(t, f, bucket.srv.URL)
	if err := f.server.store.SetRestorePending("demo/production", "could not reach the bucket", time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}

	rec := f.backup(t)
	if rec.Code != http.StatusOK {
		t.Fatalf("backup: %d %s", rec.Code, rec.Body.String())
	}
	if _, ok := decode(t, rec)["pruneSuspended"]; ok {
		t.Fatal("nothing older to protect: retention must run")
	}
	if p := f.app(t).RestorePending; p != nil {
		t.Fatalf("the guard must lift once there is nothing to protect, got %+v", p)
	}
}

func TestDismissNeedsConfirmationThenClears(t *testing.T) {
	f := newBackupFixture(t)
	if err := f.server.store.SetRestorePending("demo/production", "could not reach the bucket", time.Now()); err != nil {
		t.Fatal(err)
	}
	dismiss := func(query string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/apps/demo/production/restore/dismiss"+query, nil)
		req.SetPathValue("name", "demo")
		req.SetPathValue("env", "production")
		rec := httptest.NewRecorder()
		f.server.handleRestoreDismiss(rec, req)
		return rec
	}

	if rec := dismiss(""); rec.Code != http.StatusPreconditionRequired {
		t.Fatalf("dismissing resumes deletion of old backups, it must ask: %d", rec.Code)
	}
	if f.app(t).RestorePending == nil {
		t.Fatal("an unconfirmed dismiss must change nothing")
	}
	if rec := dismiss("?confirm=yes"); rec.Code != http.StatusOK {
		t.Fatalf("dismiss: %d %s", rec.Code, rec.Body.String())
	}
	if f.app(t).RestorePending != nil {
		t.Fatal("a confirmed dismiss must clear the guard")
	}
}

// A redeploy onto the existing database must not drop the guard: the old
// backups still need protecting. And a second empty start keeps the first
// `Since`, or the backups of the empty database become the protected ones.
func TestPendingRestoreSurvivesRedeployAndKeepsItsFirstSince(t *testing.T) {
	f := newBackupFixture(t)
	first := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	if err := f.server.store.SetRestorePending("demo/production", "could not reach the bucket", first); err != nil {
		t.Fatal(err)
	}
	if err := f.server.store.SetRestorePending("demo/production", "restore failed", first.Add(48*time.Hour)); err != nil {
		t.Fatal(err)
	}

	if _, failure := f.deploy(deployableArtifact(t)); failure != nil {
		t.Fatalf("redeploy: %v", failure)
	}

	p := f.app(t).RestorePending
	if p == nil {
		t.Fatal("a redeploy dropped the guard")
	}
	if p.Since != "2024-01-01T00:00:00Z" {
		t.Fatalf("Since must stay at the first empty start, got %s", p.Since)
	}
}

func TestPendingRestoreIsAStatusProblem(t *testing.T) {
	app := state.App{Name: "demo", Env: "production",
		RestorePending: &state.RestorePending{Since: "2024-01-01T00:00:00Z", Reason: "could not reach the bucket"}}

	line := computeStatus(listedApp{App: app, Running: true}, time.Now(), 24*time.Hour)

	if len(line.Problems) != 1 || !strings.Contains(line.Problems[0], "bay restore demo/production --dismiss") {
		t.Fatalf("status must name the problem and both ways out, got %v", line.Problems)
	}
	if line.RestorePending == nil {
		t.Fatal("the JSON view must carry the pending restore")
	}
}
