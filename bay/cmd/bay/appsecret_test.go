package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/backup"
	"github.com/alepha-dev/bay/internal/deploy"
	"github.com/alepha-dev/bay/internal/s3/s3test"
	"github.com/alepha-dev/bay/internal/state"
)

// keyFixture is a deployed app backed up to a bucket that remembers, so a
// bundle taken here can be restored here: the round trip of the key.
type keyFixture struct {
	*deployFixture
	bucket *s3test.Server
}

func newKeyFixture(t *testing.T) *keyFixture {
	t.Helper()
	f := newBackupFixture(t)
	srv := s3test.New(t)
	if err := f.server.store.SetS3(&state.S3Config{S3Target: state.S3Target{
		Endpoint: srv.URL, Bucket: srv.Bucket, AccessKey: "AK", SecretKey: "SK", Region: "auto"}, Keep: 7}); err != nil {
		t.Fatal(err)
	}
	return &keyFixture{deployFixture: f, bucket: srv}
}

func (f *keyFixture) instance() string {
	return f.server.instanceDir(state.App{Name: "demo", Env: "production"})
}

func (f *keyFixture) key(t *testing.T) string {
	t.Helper()
	k, err := deploy.ReadAppSecret(f.instance())
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func (f *keyFixture) setKey(t *testing.T, k string) {
	t.Helper()
	if err := deploy.InstallAppSecret(f.instance(), k); err != nil {
		t.Fatal(err)
	}
}

// backedUp takes a bundle and answers the key it carried and the bundle's
// directory in the bucket.
func (f *keyFixture) backedUp(t *testing.T) (key, dir string) {
	t.Helper()
	key = f.key(t)
	if key == "" {
		t.Fatal("a deployed app has a key")
	}
	if rec := f.backup(t); rec.Code != http.StatusOK {
		t.Fatalf("backup: %d %s", rec.Code, rec.Body)
	}
	for _, k := range f.bucket.Keys() {
		if strings.HasSuffix(k, "/manifest.json") {
			return key, strings.TrimSuffix(k, "manifest.json")
		}
	}
	t.Fatalf("no bundle in %v", f.bucket.Keys())
	return "", ""
}

func (f *keyFixture) restore(t *testing.T, query string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/apps/demo/production/restore?"+query, nil)
	req.SetPathValue("name", "demo")
	req.SetPathValue("env", "production")
	rec := httptest.NewRecorder()
	f.server.handleRestore(rec, req)
	return rec
}

// neverSaid fails when the key is in anything Bay wrote or answered.
func (f *keyFixture) neverSaid(t *testing.T, key string, answers ...string) {
	t.Helper()
	for _, a := range answers {
		if strings.Contains(a, key) {
			t.Fatalf("the key is in an answer: %s", a)
		}
	}
	stateFile, err := os.ReadFile(filepath.Join(f.root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(stateFile), key) {
		t.Fatal("the key is in state.json")
	}
}

func TestABundleCarriesTheKeyAsItsOwnObjectAndTheManifestOnlyItsHash(t *testing.T) {
	f := newKeyFixture(t)
	key, dir := f.backedUp(t)

	stored, ok := f.bucket.Object(dir + "app-secret")
	if !ok || string(stored) != key {
		t.Fatalf("the bundle's key object holds %q, ok=%v", stored, ok)
	}
	manifest, _ := f.bucket.Object(dir + "manifest.json")
	if strings.Contains(string(manifest), key) {
		t.Fatal("the manifest holds the key")
	}
	if !strings.Contains(string(manifest), `"appSecretSha256": "`+backup.AppSecretSHA256(key)+`"`) {
		t.Fatalf("the manifest records the key's SHA-256: %s", manifest)
	}
	f.neverSaid(t, key)
}

// The rebuilt host: provision minted a key a second ago and wrote it, then
// the auto-restore found the snapshot. The snapshot's key replaces it.
func TestAnAutoRestoreReplacesTheKeyThisDeployMinted(t *testing.T) {
	f := newKeyFixture(t)
	key, _ := f.backedUp(t)
	f.setKey(t, "minted-by-this-deploy")
	if err := os.Remove(f.databasePath()); err != nil {
		t.Fatal(err)
	}

	restore, err := f.server.maybeAutoRestore(t.Context(), f.app(t), f.databasePath(), time.Now().Add(2*time.Second), true)
	if err != nil {
		t.Fatal(err)
	}

	if got := f.key(t); got != key {
		t.Fatalf("the instance runs on %q, not the snapshot's key", got)
	}
	if restore["appSecret"] != secretRestored {
		t.Fatalf("the answer must say the key was restored: %v", restore)
	}
	answer, _ := json.Marshal(restore)
	f.neverSaid(t, key, string(answer))
}

// A key that predates the deploy is never replaced by a deploy, whatever the
// snapshot holds; the answer says the data was sealed with another one.
func TestAnAutoRestoreKeepsAKeyThatPredatesTheDeploy(t *testing.T) {
	f := newKeyFixture(t)
	f.backedUp(t)
	f.setKey(t, "the-instance-own-key")

	restore, _ := f.server.maybeAutoRestore(t.Context(), f.app(t), f.databasePath(), time.Now().Add(2*time.Second), false)

	if got := f.key(t); got != "the-instance-own-key" {
		t.Fatalf("a key that predates the deploy was replaced by %q", got)
	}
	if restore["appSecret"] != secretKept {
		t.Fatalf("answer %v", restore)
	}
	if w, _ := restore["warning"].(string); !strings.Contains(w, "--with-key") {
		t.Fatalf("the answer must say the restored data was sealed with another key, and name --with-key: %v", restore)
	}
}

// Review answer 1: the bucket configured after the first deploy. The instance
// ran empty on a key of its own; the restore that clears the hold brings the
// snapshot's key back with the data.
func TestTheRestoreThatClearsRestorePendingRestoresTheKey(t *testing.T) {
	f := newKeyFixture(t)
	key, _ := f.backedUp(t)
	f.setKey(t, "minted-while-empty")
	if err := f.server.store.SetRestorePending("demo/production", "no backup destination configured", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}

	rec := f.restore(t, "confirm=yes")

	if rec.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body)
	}
	if got := f.key(t); got != key {
		t.Fatalf("the key minted while empty survived the late restore: %q", got)
	}
	body := decode(t, rec)
	if body["appSecret"] != secretRestored || !strings.Contains(body["appSecretNote"].(string), "signed out") {
		t.Fatalf("the answer must say the key came back and what it costs: %v", body)
	}
	f.neverSaid(t, key, rec.Body.String())
}

// Outside the hold, a restore by hand keeps the instance's key and says the
// data it brought back was sealed with another one.
func TestAPlainRestoreKeepsTheInstanceKey(t *testing.T) {
	f := newKeyFixture(t)
	f.backedUp(t)
	f.setKey(t, "rotated-since")

	rec := f.restore(t, "confirm=yes")

	if rec.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body)
	}
	if got := f.key(t); got != "rotated-since" {
		t.Fatalf("a restore by hand replaced a key the instance had: %q", got)
	}
	body := decode(t, rec)
	if body["appSecret"] != secretKept || !strings.Contains(body["warning"].(string), "--with-key") {
		t.Fatalf("answer %v", body)
	}
}

// The same key on both sides is no warning.
func TestARestoreUnderTheSameKeySaysNothing(t *testing.T) {
	f := newKeyFixture(t)
	f.backedUp(t)

	body := decode(t, f.restore(t, "confirm=yes"))

	if body["appSecret"] != secretKept || body["warning"] != nil {
		t.Fatalf("answer %v", body)
	}
}

func TestWithKeyRestoresTheKeyWithTheDataAndIsRecorded(t *testing.T) {
	f := newKeyFixture(t)
	key, _ := f.backedUp(t)
	f.setKey(t, "the-wrong-key")

	rec := f.restore(t, "confirm=yes&withKey=yes")

	if rec.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body)
	}
	if got := f.key(t); got != key {
		t.Fatalf("--with-key left the instance on %q", got)
	}
	last := f.app(t).LastRestore
	if last == nil || !last.WithKey || last.AppSecret != secretRestored {
		t.Fatalf("the restore history must record --with-key: %+v", last)
	}
	f.neverSaid(t, key, rec.Body.String())
}

func TestWithKeyIsRefusedWithFrom(t *testing.T) {
	f := newKeyFixture(t)
	f.backedUp(t)

	rec := f.restore(t, "confirm=yes&withKey=yes&from=other/production")

	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "--from") {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
}

// A snapshot older than keys in bundles, stood in for by removing the
// object: the data still comes back, the key does not, and both are said.
func TestABundleWhoseKeyIsGoneStillRestoresItsData(t *testing.T) {
	f := newKeyFixture(t)
	_, dir := f.backedUp(t)
	if err := f.bucket.Client(t).Delete(t.Context(), dir+"app-secret"); err != nil {
		t.Fatal(err)
	}
	f.setKey(t, "minted-on-the-new-host")

	rec := f.restore(t, "confirm=yes")
	if rec.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", rec.Code, rec.Body)
	}
	if body := decode(t, rec); body["appSecret"] != secretMissing {
		t.Fatalf("answer %v", body)
	}
	if got := f.key(t); got != "minted-on-the-new-host" {
		t.Fatalf("key %q", got)
	}

	refused := f.restore(t, "confirm=yes&withKey=yes&key="+dir+"manifest.json")
	if refused.Code != http.StatusPreconditionFailed {
		t.Fatalf("--with-key on a bundle with no key: %d %s", refused.Code, refused.Body)
	}
}

// A key object that does not match its manifest is a corrupt bundle, refused
// before anything is installed.
func TestAKeyThatDoesNotMatchItsManifestRefusesTheBundle(t *testing.T) {
	f := newKeyFixture(t)
	_, dir := f.backedUp(t)
	f.bucket.Seed(dir+"app-secret", []byte("planted-by-someone-else"))
	f.setKey(t, "current")

	rec := f.restore(t, "confirm=yes")

	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "checksum") {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "planted-by-someone-else") {
		t.Fatal("the refusal repeats what the object holds")
	}
	if got := f.key(t); got != "current" {
		t.Fatalf("key %q", got)
	}
}

func TestPlanSecretRestore(t *testing.T) {
	app := state.App{Name: "demo", Env: "production"}
	carrying := (&backup.Fetched{}).WithAppSecret("snapshot-key")
	for _, tc := range []struct {
		name    string
		f       *backup.Fetched
		in      secretInput
		replace bool
		outcome string
	}{
		{"no key on the instance", carrying, secretInput{sameInstance: true}, true, secretRestored},
		{"minted by this deploy", carrying, secretInput{sameInstance: true, current: "m", fresh: true}, true, secretRestored},
		{"ran empty until now", carrying, secretInput{sameInstance: true, current: "m", pending: true}, true, secretRestored},
		{"--with-key", carrying, secretInput{sameInstance: true, current: "m", withKey: true}, true, secretRestored},
		{"a key of its own", carrying, secretInput{sameInstance: true, current: "m"}, false, secretKept},
		{"another instance's backup", carrying, secretInput{current: "", fresh: true, pending: true}, false, secretNotMoved},
		{"a bundle without a key", &backup.Fetched{}, secretInput{sameInstance: true, fresh: true}, false, secretAbsent},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tc.in.app = app
			plan := planSecretRestore(tc.f, tc.in)
			if plan.replace != tc.replace || plan.outcome != tc.outcome {
				t.Fatalf("plan %+v", plan)
			}
			if strings.Contains(plan.note+plan.warning, "snapshot-key") {
				t.Fatal("the plan's words name the key")
			}
		})
	}
}
