package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/runner"
	"github.com/alepha-dev/bay/internal/state"
)

/*
policyS3 is a bucket service that enforces who may touch what.

Each access key is granted a list of "bucket/prefix" scopes, optionally
narrowed to one method ("PUT bucket/prefix", "LIST bucket/prefix" for a
listing, "GET" being an object read); a request outside every scope of its key
answers 403, as a real scoped token does. As on AWS, a read of a missing object
answers 404 only to a key that may also list there, 403 to any other. That refusal
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
	// maxKeys records the max-keys of every listing, "" when unbounded.
	maxKeys []string
	// writes counts every PUT and DELETE that reached the service.
	writes int
	// slowBucket answers nothing for its requests until the caller gives up.
	slowBucket string
	// regions pins a bucket to a region: a request signed for another one is
	// refused as malformed (400), as AWS does.
	regions map[string]string
	// seedFails answers 500 to every write of an isolation seed.
	seedFails bool
	closing   chan struct{}
	srv       *httptest.Server
}

var credentialRe = regexp.MustCompile(`Credential=([^/]+)/[^/]+/([^/]+)/`)

func newPolicyS3(t *testing.T, grants map[string][]string) *policyS3 {
	t.Helper()
	p := &policyS3{grants: grants, objects: map[string]bool{}, closing: make(chan struct{})}
	p.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p.slowBucket != "" && strings.HasPrefix(r.URL.Path, "/"+p.slowBucket+"/") {
			select {
			case <-r.Context().Done():
			case <-p.closing:
			}
			return
		}
		p.mu.Lock()
		defer p.mu.Unlock()
		m := credentialRe.FindStringSubmatch(r.Header.Get("Authorization"))
		if m == nil {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		bucket, key, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, "/"), "/")
		if want, ok := p.regions[bucket]; ok && m[2] != want {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte("<Error><Code>AuthorizationHeaderMalformed</Code></Error>"))
			return
		}
		if p.seedFails && r.Method == http.MethodPut && strings.HasSuffix(key, probeSeed) {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if r.URL.Query().Has("versioning") {
			status, ok := p.versioning[bucket]
			if !ok {
				w.WriteHeader(http.StatusNotImplemented)
				return
			}
			_, _ = w.Write([]byte("<VersioningConfiguration><Status>" + status + "</Status></VersioningConfiguration>"))
			return
		}
		if r.Method == http.MethodPut || r.Method == http.MethodDelete {
			p.writes++
		}
		listing := r.Method == http.MethodGet && key == ""
		if listing {
			key = r.URL.Query().Get("prefix")
			p.maxKeys = append(p.maxKeys, r.URL.Query().Get("max-keys"))
		}
		grants := func(method string) bool {
			for _, g := range p.grants[m[1]] {
				if scoped, scope, ok := strings.Cut(g, " "); ok {
					if scoped != method {
						continue
					}
					g = scope
				}
				if strings.HasPrefix(bucket+"/"+key, g) {
					return true
				}
			}
			return false
		}
		method := r.Method
		if listing {
			method = "LIST"
		}
		allowed := grants(method)
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
			if !listing {
				if !p.objects[bucket+"/"+key] && !grants("LIST") {
					w.WriteHeader(http.StatusForbidden)
					_, _ = w.Write([]byte("<Error><Code>AccessDenied</Code></Error>"))
					return
				}
				if !p.objects[bucket+"/"+key] {
					w.WriteHeader(http.StatusNotFound)
					_, _ = w.Write([]byte("<Error><Code>NoSuchKey</Code></Error>"))
					return
				}
				_, _ = w.Write([]byte("x"))
				return
			}
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
	// Runs first: releases the slow handlers Close would otherwise wait on.
	t.Cleanup(func() { close(p.closing) })
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
	if _, failure := f.server.deployArtifact(context.Background(), deployArtifactOptions{
		Artifact: deployableArtifact(t), Name: "other", Env: "production",
	}); failure != nil {
		t.Fatalf("deploy failed: %v", failure)
	}
	if err := f.server.store.SetInstanceStorage("other/production", &state.S3Target{
		Endpoint: p.srv.URL, Bucket: "bay-blobs", AccessKey: "other-key", SecretKey: "s", Region: "auto"}, false); err != nil {
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
		Endpoint: p.srv.URL, Bucket: "bay-blobs", AccessKey: "demo-key", SecretKey: "s", Region: "auto"}, false); err != nil {
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

// The prefix the security guide says to scope to, apps/<inst>/, also holds the
// app's backups when they share the bucket: refused on apps/, the key still
// deletes its own backups.
func TestAKeyThatReachesItsOwnBackupsIsRefused(t *testing.T) {
	f, p := isolationFixture(t, false)
	p.grants["backup-key"] = []string{"bay-blobs/"}
	p.grants["inst-key"] = []string{"bay-blobs/apps/demo-production/"}
	if err := f.server.store.SetS3(&state.S3Config{S3Target: state.S3Target{Endpoint: p.srv.URL, Bucket: "bay-blobs",
		AccessKey: "backup-key", SecretKey: "s", Region: "auto"}, Keep: 7}); err != nil {
		t.Fatal(err)
	}
	rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "inst-key", ""))
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "its own backups") {
		t.Fatalf("a key reaching apps/<inst>/db/ must be refused and say so, got %d: %s", rec.Code, rec.Body)
	}
}

// A scope can grant writes without listings; overwriting a backup is a leak.
func TestAWriteOnlyLeakIsCaughtAndItsProbeRemoved(t *testing.T) {
	f, p := isolationFixture(t, false)
	p.grants["drop-key"] = []string{demoPrefix, "PUT backups/"}
	rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "drop-key", ""))
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), `"put"`) {
		t.Fatalf("a key that can write into the backups must be refused, naming the write, got %d: %s", rec.Code, rec.Body)
	}
	for k := range p.objects {
		if strings.HasSuffix(k, probeObject) {
			t.Fatalf("the probe written by the leak must be removed, found %s", k)
		}
	}
}

// One page is the answer; a large bucket must not turn it into a timeout.
func TestProbesListOnePage(t *testing.T) {
	f, p := isolationFixture(t, false)
	if rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "demo-key", "")); rec.Code != http.StatusOK {
		t.Fatalf("got %d: %s", rec.Code, rec.Body)
	}
	if len(p.maxKeys) == 0 {
		t.Fatal("no listing reached the bucket")
	}
	for _, mk := range p.maxKeys {
		if mk != "1" {
			t.Fatalf("every probe listing must ask for one key, got max-keys=%q in %v", mk, p.maxKeys)
		}
	}
}

// A key that writes but cannot list is refused - without leaving its probe.
func TestAFailedProbeLeavesNothingBehind(t *testing.T) {
	f, p := isolationFixture(t, false)
	p.grants["blind-key"] = []string{"PUT " + demoPrefix, "DELETE " + demoPrefix}
	rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "blind-key", ""))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("a key that cannot list its prefix must be refused, got %d: %s", rec.Code, rec.Body)
	}
	if p.objects[demoPrefix+probeObject] {
		t.Fatal("the probe object must be deleted even when the listing failed")
	}
}

// A key that may read but not list gets 403 for a made-up name on AWS, and
// still downloads every backup whose name it can guess.
func TestAKeyThatReadsWithoutListingIsNotIsolated(t *testing.T) {
	f, p := isolationFixture(t, false)
	p.grants["reader-key"] = []string{demoPrefix, "GET backups/"}
	rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "reader-key", ""))
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), `"get"`) {
		t.Fatalf("a key reading the backups must be refused for its get, got %d: %s", rec.Code, rec.Body)
	}
	if len(p.objects) != 0 {
		t.Fatalf("the seeds must be removed: %v", p.objects)
	}
}

// Refused on apps/ says nothing below it: another app's uploads (on the
// host-wide key, so absent from the instance keys) and its backups are tried
// where they are.
func TestAKeyReachingAnotherAppsPrefixesIsRefused(t *testing.T) {
	f, p := isolationFixture(t, false)
	if _, failure := f.server.deployArtifact(context.Background(), deployArtifactOptions{
		Artifact: bucketDeployableArtifact(t), Name: "other", Env: "production",
	}); failure != nil {
		t.Fatalf("deploy failed: %v", failure)
	}
	for grant, place := range map[string]string{
		"bay-blobs/apps/other-production/blobs/": "uploads of other/production",
		"backups/apps/other-production/db/":      "backups of other/production",
	} {
		p.grants["leaky-key"] = []string{demoPrefix, grant}
		rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "leaky-key", ""))
		if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), place) {
			t.Fatalf("a key reaching %s must be refused naming it, got %d: %s", grant, rec.Code, rec.Body)
		}
	}
}

// One place that hangs must not leave the ones after it untried.
func TestAHangingLocationDoesNotHideTheNext(t *testing.T) {
	p := newPolicyS3(t, map[string][]string{"wide": {"open/"}, "holder": {"open/", "slow/"}})
	p.slowBucket = "slow"
	defer func(d time.Duration) { probeOpTimeout = d }(probeOpTimeout)
	probeOpTimeout = 50 * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	locs := []foreignLocation{
		{what: "slow", target: *target(p.srv.URL, "slow", "holder"), prefix: "apps/"},
		{what: "open", target: *target(p.srv.URL, "open", "holder"), prefix: "apps/"},
	}
	checks, isolated := probeLocations(ctx, *target(p.srv.URL, "", "wide"), locs)
	if isolated || checks[0].Result != "unverified" || checks[1].Result != "reachable" {
		t.Fatalf("the hang must be unverified and the leak after it found: %+v", checks)
	}
}

// An app's own key as the host-wide one would hand it to every app.
func TestAppStorageRefusesAnInstanceKey(t *testing.T) {
	f, p := isolationFixture(t, false)
	if rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "demo-key", "")); rec.Code != http.StatusOK {
		t.Fatalf("got %d: %s", rec.Code, rec.Body)
	}
	rec := configStorage(t, f, `{"endpoint":"`+p.srv.URL+`","bucket":"bay-blobs","accessKey":"demo-key","secretKey":"s","region":"auto","allowShared":true}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "demo/production") {
		t.Fatalf("an instance's key must be refused as the host-wide key, naming the app, got %d: %s", rec.Code, rec.Body)
	}
}

// --allow-wide-key is remembered, so doctor can tell a known trade-off from a
// key that stopped being isolated.
func TestAWideKeyIsRememberedAsWide(t *testing.T) {
	f, p := isolationFixture(t, false)
	if rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "wide-key", `,"allowWide":true`)); rec.Code != http.StatusOK {
		t.Fatalf("got %d: %s", rec.Code, rec.Body)
	}
	raw, err := os.ReadFile(filepath.Join(f.root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	var st state.State
	if err := json.Unmarshal(raw, &st); err != nil {
		t.Fatal(err)
	}
	if !st.WideInstanceStorage["demo/production"] {
		t.Fatalf("the key must be recorded as stored wide: %s", raw)
	}
	if rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "demo-key", "")); rec.Code != http.StatusOK {
		t.Fatalf("got %d: %s", rec.Code, rec.Body)
	}
	if raw, _ := os.ReadFile(filepath.Join(f.root, "state.json")); strings.Contains(string(raw), "wideInstanceStorage") {
		t.Fatalf("an isolated key replacing it must clear the mark: %s", raw)
	}
}

// Two spellings of one service are one service: a wide key registered as
// localhost against backups at 127.0.0.1 was tried nowhere, and passed.
func TestAnotherSpellingOfTheEndpointIsStillProbed(t *testing.T) {
	f, p := isolationFixture(t, false)
	alias := strings.Replace(p.srv.URL, "127.0.0.1", "LOCALHOST", 1) + "/"
	rec := putInstanceStorage(t, f, instanceBody(alias, "bay-blobs", "wide-key", ""))
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "reachable") {
		t.Fatalf("a wide key on another spelling of the endpoint must be refused, got %d: %s", rec.Code, rec.Body)
	}
}

func TestS3ServiceSeesThroughSpellings(t *testing.T) {
	for _, same := range [][2]string{
		{"http://127.0.0.1:9000", "http://localhost:9000/"},
		{"https://minio.example.com", "https://MINIO.example.com:443"},
		{"https://s3.amazonaws.com", "https://s3.eu-west-3.amazonaws.com"},
		{"https://acc.r2.cloudflarestorage.com", "https://ACC.eu.r2.cloudflarestorage.com"},
		{"http://[::1]:9000", "http://127.0.0.1:9000"},
	} {
		if !sameS3Service(same[0], same[1]) {
			t.Errorf("%s and %s are one service", same[0], same[1])
		}
	}
	for _, other := range [][2]string{
		{"http://127.0.0.1:9000", "http://127.0.0.1:9001"},
		{"https://acc.r2.cloudflarestorage.com", "https://other.r2.cloudflarestorage.com"},
		{"https://minio.example.com", "https://s3.amazonaws.com"},
	} {
		if sameS3Service(other[0], other[1]) {
			t.Errorf("%s and %s are two services", other[0], other[1])
		}
	}
}

// Nothing to try the key against, while the host keeps data elsewhere, is not
// a proof: it may be the same service under a name Bay cannot see through.
func TestAKeyTriedAgainstNothingIsNotIsolated(t *testing.T) {
	f, p := isolationFixture(t, false)
	elsewhere := &state.S3Target{Endpoint: "https://elsewhere.example", Bucket: "backups", AccessKey: "backup-key", SecretKey: "s", Region: "auto"}
	if err := f.server.store.SetS3(&state.S3Config{S3Target: *elsewhere, Keep: 7}); err != nil {
		t.Fatal(err)
	}
	if err := f.server.store.SetStorage(nil); err != nil {
		t.Fatal(err)
	}
	rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "demo-bucket", "own-bucket", ""))
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "tried against nothing") {
		t.Fatalf("zero checks must not pass as isolated, got %d: %s", rec.Code, rec.Body)
	}
	if rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "demo-bucket", "own-bucket", `,"allowWide":true`)); rec.Code != http.StatusOK {
		t.Fatalf("--allow-wide-key stores it, got %d: %s", rec.Code, rec.Body)
	}
}

// A key works in every region; the probe must sign for the bucket's, or a
// multi-region host can never prove anything.
func TestProbesSignForTheBucketsRegion(t *testing.T) {
	f, p := isolationFixture(t, false)
	p.regions = map[string]string{"backups": "eu-west-3"}
	b := *f.server.store.S3()
	b.Region = "eu-west-3"
	if err := f.server.store.SetS3(&b); err != nil {
		t.Fatal(err)
	}
	rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "demo-key", ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("a scoped key must be proved against a bucket in another region, got %d: %s", rec.Code, rec.Body)
	}
}

// A switch that fails leaves the record as the .env still is: a stored key
// the app never got makes every later deploy treat the bucket as its own.
func TestAFailedSwitchStoresNothing(t *testing.T) {
	f, p := isolationFixture(t, true)
	f.server.repoint = func(string, string, string, *state.S3Target) error { return errors.New("disk full") }
	rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "demo-key", ""))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("got %d: %s", rec.Code, rec.Body)
	}
	if got := f.server.store.InstanceStorage("demo/production"); got != nil {
		t.Fatalf("the key must not stay stored: %+v", got)
	}
	if got := instanceEnv(t, f)["S3_ACCESS_KEY_ID"]; got != "global-key" {
		t.Fatalf("the app keeps the key it had, got %q", got)
	}
}

// The swap restarts the app: a rollback watch still running from a deploy
// would read that as the new release failing.
func TestTheSwitchEndsTheRollbackWatch(t *testing.T) {
	f, p := isolationFixture(t, true)
	watch := f.server.beginWatch("demo/production")
	if rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "demo-key", "")); rec.Code != http.StatusOK {
		t.Fatalf("got %d: %s", rec.Code, rec.Body)
	}
	if watch.Err() == nil {
		t.Fatal("the rollback watch must be cancelled by the switch")
	}
}

// Not while a restore or a deploy works on the instance.
func TestTheKeyIsNotChangedWhileTheInstanceIsBusy(t *testing.T) {
	f, p := isolationFixture(t, true)
	if _, ok := f.server.claimInstance("demo/production", "restore"); !ok {
		t.Fatal("claim")
	}
	rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "demo-key", ""))
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "restore") {
		t.Fatalf("got %d: %s", rec.Code, rec.Body)
	}
}

// The proof takes up to two minutes; what it ends on must still hold.
func TestAKeyIsNotStoredForAnAppRemovedMeanwhile(t *testing.T) {
	f, _ := isolationFixture(t, false)
	k := &state.S3Target{Endpoint: "https://s3.example", Bucket: "b", AccessKey: "k1", SecretKey: "s"}
	if err := f.server.store.SetInstanceStorage("gone/production", k, false); err == nil {
		t.Fatal("a key must not be stored for an instance that does not exist")
	}
	if err := f.server.store.SetInstanceStorage("demo/production", k, false); err != nil {
		t.Fatal(err)
	}
	if _, failure := f.server.deployArtifact(context.Background(), deployArtifactOptions{
		Artifact: deployableArtifact(t), Name: "other", Env: "production",
	}); failure != nil {
		t.Fatalf("deploy failed: %v", failure)
	}
	if err := f.server.store.SetInstanceStorage("other/production", k, false); err == nil {
		t.Fatal("one key must not be stored for two instances")
	}
}

// A key that may write but not read its own uploads breaks the app the
// moment it serves one.
func TestAKeyThatCannotReadItsOwnPrefixIsRefused(t *testing.T) {
	f, p := isolationFixture(t, false)
	p.grants["no-read"] = []string{"PUT " + demoPrefix, "LIST " + demoPrefix, "DELETE " + demoPrefix}
	rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "no-read", ""))
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "cannot read") {
		t.Fatalf("got %d: %s", rec.Code, rec.Body)
	}
}

// A seed that failed in passing leaves the get proving nothing: a key that
// reads without listing gets 403 on a made-up name and would pass.
func TestAFailedSeedLeavesTheLocationUnverified(t *testing.T) {
	f, p := isolationFixture(t, false)
	p.seedFails = true
	p.grants["reader-key"] = []string{demoPrefix, "GET backups/"}
	rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "bay-blobs", "reader-key", ""))
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "seed:") {
		t.Fatalf("a location whose seed failed must be unverified, got %d: %s", rec.Code, rec.Body)
	}
}

// An app on a bucket of its own is told where its uploads are, not the
// host-wide bucket's name.
func TestNotBackedUpNamesTheAppsOwnBucket(t *testing.T) {
	f, p := isolationFixture(t, true)
	if rec := putInstanceStorage(t, f, instanceBody(p.srv.URL, "demo-bucket", "own-bucket", `,"moved":true`)); rec.Code != http.StatusOK {
		t.Fatalf("got %d: %s", rec.Code, rec.Body)
	}
	app, _ := f.server.store.Get("demo/production")
	if got := strings.Join(notBackedUp(f.server.store, app), "\n"); !strings.Contains(got, "demo-bucket") {
		t.Fatalf("got %s", got)
	}
}
