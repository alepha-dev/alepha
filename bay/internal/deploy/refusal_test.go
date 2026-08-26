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

// Two instances that would share a unix user must not both be installed: the
// user owns each app's `.env` and database, so a shared one hands each of
// them the other's secrets.
//
// The pair below needs no truncation and no hash collision to get there -
// the "/" in a key becomes a "-", so `demo-staging/eu` and `demo/staging-eu`
// are two instances with one unit name, both comfortably inside useradd's
// limit. `runner.UserName` deliberately leaves short names alone (changing
// them would orphan the files every existing instance already owns), so this
// refusal is what closes the gap, and it is reachable in ordinary use rather
// than only through a 32-bit collision.
func TestDeployRefusesAUnixUserAnotherInstanceHolds(t *testing.T) {
	root := t.TempDir()
	store, err := state.Open(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}

	if runner.UserName("demo-staging/eu") != runner.UserName("demo/staging-eu") {
		t.Fatal("fixture error: the two keys no longer share a unix user, so this test proves nothing")
	}

	// Explicit, distinct domains. The derived one is built from the same key
	// with the same lossy "/" replacement, so leaving them to Bay makes the
	// two instances collide on DOMAIN first and the domain claim refuses them
	// before the user check is ever consulted - which is worth knowing (that
	// guard catches the sub-case) and useless for reaching this one.
	if _, err := Run(Options{
		Root:       root,
		Artifact:   artifact(t, "demo-staging"),
		Name:       "demo-staging",
		Env:        "eu",
		Domains:    []string{"first.bay.test"},
		BaseDomain: "bay.test",
	}, store); err != nil {
		t.Fatalf("the first instance must install normally: %v", err)
	}

	_, err = Run(Options{
		Root:       root,
		Artifact:   artifact(t, "demo"),
		Name:       "demo",
		Env:        "staging-eu",
		Domains:    []string{"second.bay.test"},
		BaseDomain: "bay.test",
	}, store)
	if err == nil {
		t.Fatal("the second instance was installed as the same unix user as the first")
	}
	// The message has to name both instances and the user: an operator who
	// hits this needs to know which pair to rename, and "unix user" is not a
	// phrase they will guess from a bare conflict.
	for _, want := range []string{"demo/staging-eu", "demo-staging/eu", "bay-demo-staging-eu"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("refusal does not mention %q: %v", want, err)
		}
	}

	// The refusal must not fire on a redeploy of the instance itself, which
	// obviously holds its own user.
	if _, err := Run(Options{
		Root:       root,
		Artifact:   artifact(t, "demo-staging"),
		Name:       "demo-staging",
		Env:        "eu",
		Domains:    []string{"first.bay.test"},
		BaseDomain: "bay.test",
	}, store); err != nil {
		t.Fatalf("an instance must be allowed to redeploy over itself: %v", err)
	}
}
