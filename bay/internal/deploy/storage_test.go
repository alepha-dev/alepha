package deploy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alepha/bay/internal/state"
)

// bucketArtifact declares `$storage`, which is what puts `hasBucket: true` in
// the manifest and therefore what asks Bay for somewhere to put blobs.
func bucketArtifact(t *testing.T, name string) string {
	t.Helper()
	return buildArchive(t,
		entry{name: "dist/manifest.json", body: `{
			"project": "` + name + `",
			"entry": "index.js",
			"runtime": "node",
			"resources": { "hasBucket": true }
		}`},
		entry{name: "dist/index.js", body: "process.exit(0)"},
	)
}

func blobStore() *state.S3Target {
	return &state.S3Target{
		Endpoint:  "https://acct.r2.cloudflarestorage.com",
		Bucket:    "bay-blobs",
		AccessKey: "blob-access",
		SecretKey: "blob-secret",
		Region:    "auto",
	}
}

// deployBucketApp runs a real deploy of a blob-using app, with or without a
// storage backend configured on this Bay.
func deployBucketApp(t *testing.T, root string, store *state.Store, storage *state.S3Target) (*Result, error) {
	t.Helper()
	return Run(Options{
		Root:       root,
		Artifact:   bucketArtifact(t, "demo"),
		Name:       "demo",
		Env:        "production",
		BaseDomain: "bay.test",
		Storage:    storage,
	}, store)
}

func envOf(t *testing.T, root string) string {
	t.Helper()
	return flatEnv(t, filepath.Join(root, "apps", "demo", "production", ".env"))
}

func newRoot(t *testing.T) (string, *state.Store) {
	t.Helper()
	root := t.TempDir()
	store, err := state.Open(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	return root, store
}

func TestBlobsStayOnDiskWhenBayHasNoStorage(t *testing.T) {
	// The default has to keep working on a Bay nobody has configured. Blobs on
	// local disk, backed up by the storage tar, exactly as before.
	root, store := newRoot(t)
	if _, err := deployBucketApp(t, root, store, nil); err != nil {
		t.Fatal(err)
	}

	env := envOf(t, root)
	if !strings.Contains(env, "STORAGE_PATH=") {
		t.Fatalf("a local app still needs STORAGE_PATH, .env was:\n%s", env)
	}
	if strings.Contains(env, "S3_ENDPOINT=") {
		t.Fatalf("no storage is configured, so no S3 credentials may appear:\n%s", env)
	}

	app, _ := store.Get("demo/production")
	if app.StorageBackend != "local" {
		t.Fatalf("expected the local backend to be recorded, got %q", app.StorageBackend)
	}
}

func TestConfiguredStorageSendsBlobsToObjectStorage(t *testing.T) {
	root, store := newRoot(t)
	if _, err := deployBucketApp(t, root, store, blobStore()); err != nil {
		t.Fatal(err)
	}

	env := envOf(t, root)
	for _, want := range []string{
		"S3_ENDPOINT=https://acct.r2.cloudflarestorage.com",
		"S3_BUCKET_NAME=bay-blobs",
		"S3_ACCESS_KEY_ID=blob-access",
		"S3_SECRET_ACCESS_KEY=blob-secret",
		"S3_REGION=auto",
		// The prefix Bay controls, mirroring the backup key layout so one
		// bucket can hold `apps/<name>/<env>/{db,storage,blobs}/` coherently.
		"S3_KEY_PREFIX=apps/demo/production/blobs",
	} {
		if !strings.Contains(env, want) {
			t.Errorf("missing %q in .env:\n%s", want, env)
		}
	}
	// Both would be a lie about where the blobs are. The provider picks S3 the
	// moment S3_ENDPOINT is set, so a leftover STORAGE_PATH points at a
	// directory nothing will ever write to.
	if strings.Contains(env, "STORAGE_PATH=") {
		t.Errorf("STORAGE_PATH must be dropped when blobs go to S3:\n%s", env)
	}

	app, _ := store.Get("demo/production")
	if app.StorageBackend != "s3" {
		t.Fatalf("expected the s3 backend to be recorded, got %q", app.StorageBackend)
	}
}

func TestAppNameCarriesTheEnvironment(t *testing.T) {
	// Bay is the authority for the app's identity, and `<app>-<env>` is what
	// every other Bay surface calls this instance. It is also what keeps the
	// legacy S3 prefix fallback safe: a bare "demo" would merge staging and
	// production blobs if S3_KEY_PREFIX were ever absent.
	root, store := newRoot(t)
	if _, err := Run(Options{
		Root: root, Artifact: artifact(t, "demo"), Name: "demo",
		Env: "staging", BaseDomain: "bay.test",
	}, store); err != nil {
		t.Fatal(err)
	}

	raw := flatEnv(t, filepath.Join(root, "apps", "demo", "staging", ".env"))
	if !strings.Contains(raw, "APP_NAME=demo-staging") {
		t.Fatalf("expected APP_NAME=demo-staging, .env was:\n%s", raw)
	}
}

func TestAnAppMayBringItsOwnBucket(t *testing.T) {
	// Same rule as a BYO DATABASE_URL: an endpoint the user put there wins, and
	// Bay steps back rather than redirecting the app's uploads to its own
	// bucket on the next redeploy.
	root, store := newRoot(t)
	if _, err := deployBucketApp(t, root, store, nil); err != nil {
		t.Fatal(err)
	}

	envPath := filepath.Join(root, "apps", "demo", "production", ".env")
	if err := os.WriteFile(envPath, []byte(
		"S3_ENDPOINT=https://minio.example.com\n"+
			"S3_BUCKET_NAME=mine\n"+
			"S3_ACCESS_KEY_ID=my-key\n"+
			"S3_SECRET_ACCESS_KEY=my-secret\n"+
			"STRIPE_KEY=sk_live_keepme\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := deployBucketApp(t, root, store, blobStore()); err != nil {
		t.Fatal(err)
	}

	env := envOf(t, root)
	if !strings.Contains(env, "S3_ENDPOINT=https://minio.example.com") {
		t.Errorf("a BYO endpoint must survive a redeploy:\n%s", env)
	}
	if strings.Contains(env, "bay-blobs") {
		t.Errorf("Bay must not redirect an app that brought its own bucket:\n%s", env)
	}
	if !strings.Contains(env, "STRIPE_KEY=sk_live_keepme") {
		t.Errorf("a user's own key must survive a redeploy:\n%s", env)
	}
}

func TestAnAppWithoutABucketGetsNoCredentials(t *testing.T) {
	// Least privilege: declaring `$storage` is what asks for object storage.
	// An app that never declared it has no business holding a key to the
	// bucket every other app writes into.
	root, store := newRoot(t)
	if _, err := Run(Options{
		Root: root, Artifact: artifact(t, "demo"), Name: "demo",
		Env: "production", BaseDomain: "bay.test", Storage: blobStore(),
	}, store); err != nil {
		t.Fatal(err)
	}

	// Assignments, not bare names: the file's header comment lists every
	// Bay-owned key whether or not it was written, so a substring match on the
	// name alone matches the documentation of the thing rather than the thing.
	env := envOf(t, root)
	for _, assignment := range []string{"S3_ACCESS_KEY_ID=", "S3_ENDPOINT=", "S3_KEY_PREFIX="} {
		if strings.Contains(env, assignment) {
			t.Fatalf("an app declaring no bucket must get no S3 credentials, found %q:\n%s", assignment, env)
		}
	}
}

func TestSwitchingBackendsRefusesToStrandExistingFiles(t *testing.T) {
	// The failure this prevents is silent: the app comes up healthy, answers
	// every health check, and every file uploaded before the switch 404s.
	// Same discipline as DatabaseCreated — a routine redeploy must never
	// become data loss.
	root, store := newRoot(t)
	if _, err := deployBucketApp(t, root, store, nil); err != nil {
		t.Fatal(err)
	}

	storageDir := filepath.Join(root, "apps", "demo", "production", "storage")
	if err := os.MkdirAll(filepath.Join(storageDir, "avatars"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(storageDir, "avatars", "a.png"), []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := deployBucketApp(t, root, store, blobStore())
	if err == nil {
		t.Fatal("switching an app with existing local files must be refused")
	}
	if !strings.Contains(err.Error(), "bay storage migrate") {
		t.Fatalf("the refusal must name the fix, got: %v", err)
	}

	// And the refusal must leave the app exactly as it was.
	app, _ := store.Get("demo/production")
	if app.StorageBackend != "local" {
		t.Fatalf("a refused switch must not change the backend, got %q", app.StorageBackend)
	}
	env := envOf(t, root)
	if strings.Contains(env, "S3_ENDPOINT=") {
		t.Fatalf("a refused switch must not write credentials:\n%s", env)
	}
}

// The reverse direction — an S3-backed app deployed by a Bay whose storage
// config has gone (hand-edited state.json, rolled-back binary) — needs no
// guard, and this test is what establishes that rather than leaving it to be
// re-investigated.
//
// The credentials live in the app's own `.env`, not in Bay's state, so the app
// keeps reading the same bucket. Bay only writes the local branch when there is
// no `S3_ENDPOINT` at all, which by then means someone deleted it by hand — an
// explicit request for local storage, not an accident to defend against.
//
// Refusing here would break a deploy that otherwise works perfectly.
func TestAnS3BackedAppKeepsItsBucketWhenBayForgetsTheConfig(t *testing.T) {
	root, store := newRoot(t)
	if _, err := deployBucketApp(t, root, store, blobStore()); err != nil {
		t.Fatal(err)
	}

	if _, err := deployBucketApp(t, root, store, nil); err != nil {
		t.Fatalf("the app must still deploy: %v", err)
	}

	env := envOf(t, root)
	if !strings.Contains(env, "S3_KEY_PREFIX=apps/demo/production/blobs") {
		t.Fatalf("the app must still point at its bucket:\n%s", env)
	}
	if strings.Contains(env, "STORAGE_PATH=") {
		t.Fatalf("it must not be silently repointed at empty local disk:\n%s", env)
	}
	if app, _ := store.Get("demo/production"); app.StorageBackend != "s3" {
		t.Fatalf("the recorded backend must still be s3, got %q", app.StorageBackend)
	}
}

func TestSwitchingBackendsIsFineWithNoFilesYet(t *testing.T) {
	// The common case: an app that declared `$storage` but has not received an
	// upload yet has nothing to strand, so it must not need a migration.
	root, store := newRoot(t)
	if _, err := deployBucketApp(t, root, store, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := deployBucketApp(t, root, store, blobStore()); err != nil {
		t.Fatalf("an empty storage directory must not block the switch: %v", err)
	}

	app, _ := store.Get("demo/production")
	if app.StorageBackend != "s3" {
		t.Fatalf("expected the switch to go through, got %q", app.StorageBackend)
	}
}
