package deploy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alepha/bay/internal/runner"
	"github.com/alepha/bay/internal/state"
)

// `bay env set` accepts a value of up to 1 MiB; the reader used bufio's
// 64 KiB default, so the next `LoadEnvFile` (every start, every env command,
// every deploy) failed with "token too long" and the instance was bricked.
func TestEnvFileRoundTripsALongValue(t *testing.T) {
	instance := t.TempDir()
	if err := os.WriteFile(filepath.Join(instance, ".env"), []byte("APP_SECRET=x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	big := strings.Repeat("a", 100*1024)
	updates, err := ParseAssignments(strings.NewReader("BIG=" + big + "\n"))
	if err != nil {
		t.Fatalf("ParseAssignments refused a 100 KiB value: %v", err)
	}
	if _, err := SetEnv(instance, updates); err != nil {
		t.Fatalf("SetEnv refused: %v", err)
	}

	env, err := runner.LoadEnvFile(filepath.Join(instance, ".env"))
	if err != nil {
		t.Fatalf("the value the writer accepted must be readable: %v", err)
	}
	if env["BIG"] != big {
		t.Fatalf("the value did not survive the round trip (got %d bytes)", len(env["BIG"]))
	}
	if _, _, err := EnvKeys(instance); err != nil {
		t.Fatalf("EnvKeys must read the file too: %v", err)
	}
}

// A deploy refused after the staging directory was moved into `releases/`
// used to leave that directory behind as the NEWEST release: it took a keep
// slot, the proxy served its files, and the startup prune evicted the real
// rollback target instead of it.
func TestRefusedDeployLeavesNoOrphanRelease(t *testing.T) {
	root, store := newRoot(t)
	if _, err := deployBucketApp(t, root, store, nil); err != nil {
		t.Fatal(err)
	}
	instance := filepath.Join(root, "apps", "demo", "production")
	storageDir := filepath.Join(instance, "storage")
	if err := os.MkdirAll(filepath.Join(storageDir, "avatars"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(storageDir, "avatars", "a.png"), []byte("png"), 0o644); err != nil {
		t.Fatal(err)
	}
	before, _ := Releases(instance)
	serving, _ := servingRelease(instance)

	// Refused by provision: local uploads would be stranded by an S3 backend.
	if _, err := deployBucketApp(t, root, store, blobStore()); err == nil {
		t.Fatal("expected the strand-files refusal")
	}
	after, _ := Releases(instance)
	if len(after) != len(before) {
		t.Fatalf("a refused deploy must leave the releases as they were, before=%v after=%v", before, after)
	}

	// Refused by the domain check, which runs after the rename as well.
	if err := store.Upsert(state.App{Name: "other", Env: "production", Domains: []string{"d2.test"}, Release: "r", Port: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := Run(Options{Root: root, Artifact: bucketArtifact(t, "demo"), Name: "demo", Env: "production",
		Domains: []string{"d2.test"}, BaseDomain: "bay.test"}, store); err == nil {
		t.Fatal("expected the domain conflict refusal")
	}
	after, _ = Releases(instance)
	if len(after) != len(before) {
		t.Fatalf("a domain conflict must leave the releases as they were, before=%v after=%v", before, after)
	}
	if now, _ := servingRelease(instance); now != serving {
		t.Fatalf("the serving release moved from %q to %q", serving, now)
	}
}

// A static site redeployed as a process app under the same key inherited the
// static record's port 0, so the process bound a random port that the
// readiness probe never found.
func TestStaticToProcessRedeployAllocatesAPort(t *testing.T) {
	root, store := newRoot(t)
	first := deployStatic(t, root, store, "docs")
	if first.App.Port != 0 || !first.App.Static {
		t.Fatalf("fixture: a static deploy has no port, got %+v", first.App)
	}

	res, err := Run(Options{
		Root: root, Artifact: artifact(t, "docs"), Name: "docs",
		Env: "production", BaseDomain: "bay.test",
	}, store)
	if err != nil {
		t.Fatal(err)
	}

	if res.App.Port == 0 {
		t.Fatal("the process app must get a real port, not the static record's 0")
	}
	env, err := runner.LoadEnvFile(filepath.Join(root, "apps", "docs", "production", ".env"))
	if err != nil {
		t.Fatal(err)
	}
	if env["SERVER_PORT"] == "0" || env["SERVER_PORT"] == "" {
		t.Fatalf("SERVER_PORT must name the allocated port, got %q", env["SERVER_PORT"])
	}
}
