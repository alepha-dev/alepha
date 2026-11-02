package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/runner"
	"github.com/alepha-dev/bay/internal/state"
)

/*
policyS3 is a bucket service that enforces who may touch what.

Each access key is granted a list of "bucket/prefix" scopes; a request outside
every scope of its key answers 403, as a real scoped token does. That refusal
is the evidence the isolation proof reads, so a fake that said yes to
everything (fakeS3) could not tell an isolated key from a wide one.
*/
type policyS3 struct {
	mu      sync.Mutex
	grants  map[string][]string
	objects map[string]bool
	// versioning is GET ?versioning's answer per bucket; a bucket missing
	// from it answers 501, as R2 does.
	versioning map[string]string
	// broken answers 500 outside this access key's grants: neither yes nor no.
	broken string
	srv    *httptest.Server
}

var credentialRe = regexp.MustCompile(`Credential=([^/]+)/`)

func newPolicyS3(t *testing.T, grants map[string][]string) *policyS3 {
	t.Helper()
	p := &policyS3{grants: grants, objects: map[string]bool{}}
	p.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p.mu.Lock()
		defer p.mu.Unlock()
		m := credentialRe.FindStringSubmatch(r.Header.Get("Authorization"))
		if m == nil {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		bucket, key, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, "/"), "/")
		if r.URL.Query().Has("versioning") {
			status, ok := p.versioning[bucket]
			if !ok {
				w.WriteHeader(http.StatusNotImplemented)
				return
			}
			_, _ = w.Write([]byte("<VersioningConfiguration><Status>" + status + "</Status></VersioningConfiguration>"))
			return
		}
		if r.Method == http.MethodGet {
			key = r.URL.Query().Get("prefix")
		}
		allowed := false
		for _, g := range p.grants[m[1]] {
			if strings.HasPrefix(bucket+"/"+key, g) {
				allowed = true
			}
		}
		if !allowed && m[1] == p.broken {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if !allowed {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte("<Error><Code>AccessDenied</Code></Error>"))
			return
		}
		switch r.Method {
		case http.MethodPut:
			p.objects[bucket+"/"+key] = true
		case http.MethodDelete:
			delete(p.objects, bucket+"/"+key)
			w.WriteHeader(http.StatusNoContent)
		case http.MethodGet:
			var names []string
			for k := range p.objects {
				if strings.HasPrefix(k, bucket+"/"+key) {
					names = append(names, strings.TrimPrefix(k, bucket+"/"))
				}
			}
			sort.Strings(names)
			var b strings.Builder
			b.WriteString(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>false</IsTruncated>`)
			for _, k := range names {
				b.WriteString("<Contents><Key>" + k + "</Key><Size>1</Size></Contents>")
			}
			b.WriteString("</ListBucketResult>")
			w.Header().Set("Content-Type", "application/xml")
			_, _ = w.Write([]byte(b.String()))
		}
	}))
	t.Cleanup(p.srv.Close)
	return p
}

const demoPrefix = "bay-blobs/apps/demo-production/blobs/"

// isolationFixture: demo/production deployed on the host-wide blob bucket,
// backups in a second bucket on the same service.
func isolationFixture(t *testing.T, bucketBackend bool) (*deployFixture, *policyS3) {
	t.Helper()
	p := newPolicyS3(t, map[string][]string{
		"backup-key": {"backups/"},
		"global-key": {"bay-blobs/"},
		"demo-key":   {demoPrefix},
		"wide-key":   {"bay-blobs/", "backups/"},
		"other-key":  {"bay-blobs/apps/other-production/blobs/"},
		"own-bucket": {"demo-bucket/"},
		"no-write":   {},
		"flaky":      {demoPrefix},
	})
	p.broken = "flaky"
	f := newDeployFixture(t)
	if err := f.server.store.SetStorage(&state.S3Target{Endpoint: p.srv.URL, Bucket: "bay-blobs",
		AccessKey: "global-key", SecretKey: "s", Region: "auto"}); err != nil {
		t.Fatal(err)
	}
	if err := f.server.store.SetS3(&state.S3Config{S3Target: state.S3Target{Endpoint: p.srv.URL, Bucket: "backups",
		AccessKey: "backup-key", SecretKey: "s", Region: "auto"}, Keep: 7}); err != nil {
		t.Fatal(err)
	}
	artifact := deployableArtifact(t)
	if bucketBackend {
		artifact = bucketDeployableArtifact(t)
	}
	if _, failure := f.server.deployArtifact(context.Background(), deployArtifactOptions{
		Artifact: artifact, Name: "demo", Env: "production",
	}); failure != nil {
		t.Fatalf("deploy failed: %v", failure)
	}
	return f, p
}

func putInstanceStorage(t *testing.T, f *deployFixture, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/apps/demo/production/storage", strings.NewReader(body))
	req.SetPathValue("name", "demo")
	req.SetPathValue("env", "production")
	rec := httptest.NewRecorder()
	f.server.handleSetInstanceStorage(rec, req)
	return rec
}

func instanceBody(endpoint, bucket, key string, extra string) string {
	return `{"endpoint":"` + endpoint + `","bucket":"` + bucket + `","accessKey":"` + key +
		`","secretKey":"s","region":"auto"` + extra + `}`
}

func instanceEnv(t *testing.T, f *deployFixture) map[string]string {
	t.Helper()
	env, err := runner.LoadEnvFile(filepath.Join(f.root, "apps", naming.Instance("demo", "production"), ".env"))
	if err != nil {
		t.Fatal(err)
	}
	return env
}

// The point of the feature: a key S3 itself confines to the app's prefix is
// stored, and the app runs with it rather than with the key every app holds.
func TestAScopedKeyIsStoredAndHandedToTheApp(t *testing.T) {
	f, p := isolationFixture(t, true)
	if got := instanceEnv(t, f)["S3_ACCESS_KEY_ID"]; got != "global-key" {
		t.Fatalf("precondition: the app starts on the host-wide key, got %q", got)
	}

	rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "demo-key", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("a scoped key must be accepted, got %d: %s", rec.Code, rec.Body)
	}
	if iso := decodeJSONBody(t, rec)["isolation"].(map[string]any); iso["isolated"] != true {
		t.Fatalf("the proof must report it isolated: %v", iso)
	}
	if got := instanceEnv(t, f)["S3_ACCESS_KEY_ID"]; got != "demo-key" {
		t.Fatalf("an app already on the bucket must be switched to its own key, .env has %q", got)
	}
	if got := f.server.store.StorageFor("demo/production"); got == nil || got.AccessKey != "demo-key" {
		t.Fatalf("the next deploy must use the instance key, got %+v", got)
	}
	if len(p.objects) != 0 {
		t.Fatalf("the write probe must clean up after itself: %v", p.objects)
	}
}

// A new deploy, not only the swap, must pick the instance key up.
func TestTheNextDeployUsesTheInstanceKey(t *testing.T) {
	f, p := isolationFixture(t, false)
	if rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "demo-key", "")); rec.Code != http.StatusOK {
		t.Fatalf("got %d: %s", rec.Code, rec.Body)
	}
	if _, failure := f.server.deployArtifact(context.Background(), deployArtifactOptions{
		Artifact: bucketDeployableArtifact(t), Name: "demo", Env: "production",
	}); failure != nil {
		t.Fatalf("deploy failed: %v", failure)
	}
	if got := instanceEnv(t, f)["S3_ACCESS_KEY_ID"]; got != "demo-key" {
		t.Fatalf("deploy wrote %q, want the instance key", got)
	}
}

// A key that can list the backups, or the whole blob bucket, isolates nothing.
func TestAWideKeyIsRefusedUnlessAllowed(t *testing.T) {
	f, p := isolationFixture(t, false)

	rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "wide-key", ""))
	if rec.Code != http.StatusConflict {
		t.Fatalf("a key reaching the backups must be refused, got %d: %s", rec.Code, rec.Body)
	}
	if f.server.store.InstanceStorage("demo/production") != nil {
		t.Fatal("a refused key must not be stored")
	}
	if !strings.Contains(rec.Body.String(), "reachable") {
		t.Fatalf("the refusal must show which place was reachable: %s", rec.Body)
	}

	rec = putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "wide-key", `,"allowWide":true`))
	if rec.Code != http.StatusOK {
		t.Fatalf("--allow-wide-key must store it, got %d: %s", rec.Code, rec.Body)
	}
}

// Not knowing is not the same as isolated.
func TestAnUnverifiableKeyIsRefused(t *testing.T) {
	f, p := isolationFixture(t, false)
	rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "flaky", ""))
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "unverified") {
		t.Fatalf("a key whose checks errored must not count as isolated, got %d: %s", rec.Code, rec.Body)
	}
}

func TestAKeyThatCannotWriteItsOwnPrefixIsRefused(t *testing.T) {
	f, p := isolationFixture(t, false)
	rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "no-write", `,"allowWide":true`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("a key that cannot write must be refused even with allowWide, got %d: %s", rec.Code, rec.Body)
	}
}

// Proved shared, not merely unproved: no flag lifts these.
func TestKeysAlreadyHeldElsewhereAreAlwaysRefused(t *testing.T) {
	f, p := isolationFixture(t, false)
	for _, k := range []string{"backup-key", "global-key"} {
		rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", k, `,"allowWide":true`))
		if rec.Code != http.StatusConflict {
			t.Fatalf("%s must be refused, got %d: %s", k, rec.Code, rec.Body)
		}
	}
	if err := f.server.store.SetInstanceStorage("other/production", &state.S3Target{
		Endpoint: p.srv.URL, Bucket: "bay-blobs", AccessKey: "other-key", SecretKey: "s", Region: "auto"}); err != nil {
		t.Fatal(err)
	}
	rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "other-key", `,"allowWide":true`))
	if rec.Code != http.StatusConflict {
		t.Fatalf("another app's key must be refused, got %d: %s", rec.Code, rec.Body)
	}
}

// One bucket per app is what R2 can offer: the whole bucket is the app's.
func TestABucketOfItsOwnIsIsolation(t *testing.T) {
	f, p := isolationFixture(t, false)
	rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "demo-bucket", "own-bucket", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("a key confined to its own bucket must be accepted, got %d: %s", rec.Code, rec.Body)
	}
}

// Switching bucket under an app that stores blobs would strand them.
func TestChangingBucketUnderAnS3AppNeedsMoved(t *testing.T) {
	f, p := isolationFixture(t, true)
	rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "demo-bucket", "own-bucket", ""))
	if rec.Code != http.StatusConflict {
		t.Fatalf("a bucket change must be refused without --moved, got %d: %s", rec.Code, rec.Body)
	}
	rec = putInstanceStorage(t, f, instanceBody(p.srv.URL, "demo-bucket", "own-bucket", `,"moved":true`))
	if rec.Code != http.StatusOK {
		t.Fatalf("--moved must allow it, got %d: %s", rec.Code, rec.Body)
	}
	if env := instanceEnv(t, f); env["S3_BUCKET_NAME"] != "demo-bucket" || env["S3_ACCESS_KEY_ID"] != "own-bucket" {
		t.Fatalf("the app must be repointed, .env has %v", env)
	}
}

func TestGetInstanceStorageNeverEchoesTheSecret(t *testing.T) {
	f, p := isolationFixture(t, false)
	if rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "demo-key", "")); rec.Code != http.StatusOK {
		t.Fatalf("got %d: %s", rec.Code, rec.Body)
	}
	req := httptest.NewRequest(http.MethodGet, "/apps/demo/production/storage?check=yes", nil)
	req.SetPathValue("name", "demo")
	req.SetPathValue("env", "production")
	rec := httptest.NewRecorder()
	f.server.handleGetInstanceStorage(rec, req)
	if strings.Contains(rec.Body.String(), "demo-key") || strings.Contains(rec.Body.String(), `"s"`) {
		t.Fatalf("GET must not echo credentials: %s", rec.Body)
	}
	if decodeJSONBody(t, rec)["isolation"] == nil {
		t.Fatalf("?check=yes must re-run the proof: %s", rec.Body)
	}
}

func TestRemovingTheAppForgetsItsKey(t *testing.T) {
	f, p := isolationFixture(t, false)
	if rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "demo-key", "")); rec.Code != http.StatusOK {
		t.Fatalf("got %d: %s", rec.Code, rec.Body)
	}
	if _, _, err := f.server.store.Remove("demo/production"); err != nil {
		t.Fatal(err)
	}
	if f.server.store.InstanceStorage("demo/production") != nil {
		t.Fatal("a key outliving its app would be handed to the next app of that name")
	}
}

// 2a: the halves refuse each other's key unless told otherwise.
func TestAppStorageRefusesTheBackupKey(t *testing.T) {
	f, p := isolationFixture(t, false)
	body := `{"endpoint":"` + p.srv.URL + `","bucket":"backups","accessKey":"backup-key","secretKey":"s","region":"auto"`
	if rec := configStorage(t, f, body+`}`); rec.Code != http.StatusConflict {
		t.Fatalf("s3:apps with the backup key must be refused, got %d: %s", rec.Code, rec.Body)
	}
	if rec := configStorage(t, f, body+`,"allowShared":true}`); rec.Code != http.StatusOK {
		t.Fatalf("--allow-shared-key must store it, got %d: %s", rec.Code, rec.Body)
	}
	if !f.server.store.CredentialsShared() {
		t.Fatal("and it must still be reported as shared")
	}
}

func TestBackupDestinationRefusesAnAppKey(t *testing.T) {
	f, p := isolationFixture(t, false)
	put := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPut, "/config/s3", strings.NewReader(body))
		rec := httptest.NewRecorder()
		f.server.handleConfigS3(rec, req)
		return rec
	}
	body := `{"endpoint":"` + p.srv.URL + `","bucket":"backups","accessKey":"global-key","secretKey":"s","region":"auto","keep":3`
	if rec := put(body + `}`); rec.Code != http.StatusConflict {
		t.Fatalf("s3:backups with the app key must be refused, got %d: %s", rec.Code, rec.Body)
	}
	if rec := put(body + `,"allowShared":true}`); rec.Code != http.StatusOK {
		t.Fatalf("--allow-shared-key must store it, got %d: %s", rec.Code, rec.Body)
	}
	if got := f.server.store.S3(); got == nil || got.Keep != 3 {
		t.Fatalf("the wrapped body must still decode every field, got %+v", got)
	}

	if err := f.server.store.SetInstanceStorage("demo/production", &state.S3Target{
		Endpoint: p.srv.URL, Bucket: "bay-blobs", AccessKey: "demo-key", SecretKey: "s", Region: "auto"}); err != nil {
		t.Fatal(err)
	}
	body = `{"endpoint":"` + p.srv.URL + `","bucket":"backups","accessKey":"demo-key","secretKey":"s","region":"auto"}`
	if rec := put(body); rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "demo/production") {
		t.Fatalf("an instance's key must be refused for backups, naming the app, got %d: %s", rec.Code, rec.Body)
	}
}

// An app on a bucket it brought itself (S3_* in its secrets) is not Bay's to
// re-key: rewriting its .env would point it at a bucket without its files.
func TestAnAppOnItsOwnBucketIsNotReKeyed(t *testing.T) {
	f, p := isolationFixture(t, true)
	envPath := filepath.Join(f.root, "apps", naming.Instance("demo", "production"), ".env")
	raw, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(envPath, []byte(strings.Replace(string(raw), `S3_BUCKET_NAME="bay-blobs"`, `S3_BUCKET_NAME="their-bucket"`, 1)), 0o600); err != nil {
		t.Fatal(err)
	}
	if instanceEnv(t, f)["S3_BUCKET_NAME"] != "their-bucket" {
		t.Fatalf("precondition: the .env must name the app's own bucket, got %s", raw)
	}
	rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "demo-key", ""))
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "its own bucket") {
		t.Fatalf("got %d: %s", rec.Code, rec.Body)
	}
}

func decodeJSONBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v\n%s", err, rec.Body.String())
	}
	return body
}
