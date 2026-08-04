package deploy

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/alepha/bay/internal/state"
)

// staticArtifact builds the archive `alepha build --target=static` produces:
// a manifest declaring no entry point to spawn, and the prerendered files.
func staticArtifact(t *testing.T, name string) string {
	t.Helper()
	return buildArchive(t,
		entry{name: "dist/manifest.json", body: `{
			"project": "` + name + `",
			"runtime": "static"
		}`},
		entry{name: "dist/public/index.html", body: "<html></html>"},
	)
}

func deployStatic(t *testing.T, root string, store *state.Store, name string) *Result {
	t.Helper()
	res, err := Run(Options{
		Root:       root,
		Artifact:   staticArtifact(t, name),
		Name:       name,
		Env:        "production",
		BaseDomain: "bay.test",
	}, store)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

// newStore opens a fresh store under root.
func newStore(t *testing.T, root string) *state.Store {
	t.Helper()
	store, err := state.Open(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	return store
}

func TestStaticDeployMarksTheAppStatic(t *testing.T) {
	// The proxy reads this on every request to decide whether there is anything
	// to forward to. Derived from the manifest here, once.
	root := t.TempDir()
	store := newStore(t, root)

	res := deployStatic(t, root, store, "docs")

	if !res.App.Static {
		t.Fatal("a static artifact must register a static app")
	}
}

func TestStaticDeployAllocatesNoPort(t *testing.T) {
	// Nothing listens, so a reserved port would be a port no other app can have
	// and no process will ever bind.
	root := t.TempDir()
	store := newStore(t, root)

	res := deployStatic(t, root, store, "docs")

	if res.App.Port != 0 {
		t.Fatalf("a static app needs no port, got %d", res.App.Port)
	}
	if len(store.UsedPorts()) != 0 {
		t.Fatalf("a static app must not consume the port pool, got %v", store.UsedPorts())
	}
}

func TestStaticDeployWritesNoEnvFile(t *testing.T) {
	// No process reads it. Writing one would mint an APP_SECRET nobody uses and
	// leave a 0600 file on disk whose only effect is to look like a secret worth
	// stealing.
	root := t.TempDir()
	store := newStore(t, root)

	deployStatic(t, root, store, "docs")

	envPath := filepath.Join(root, "apps", "docs", "production", ".env")
	if _, err := os.Stat(envPath); !os.IsNotExist(err) {
		t.Fatalf("a static app must have no .env, stat gave: %v", err)
	}
}

func TestStaticDeployProvisionsNoDatabase(t *testing.T) {
	root := t.TempDir()
	store := newStore(t, root)

	res := deployStatic(t, root, store, "docs")

	if res.DatabasePath != "" {
		t.Fatalf("a static app has no database, got %q", res.DatabasePath)
	}
	if res.App.Backups {
		t.Fatal("a static app has nothing to back up and must not be marked for backups")
	}
}

func TestProcessAppStillGetsAPortAndEnv(t *testing.T) {
	// The guard rail on the change above: a node app must be unaffected.
	root := t.TempDir()
	store := newStore(t, root)

	res := runDeploy(t, root, store, "demo")

	if res.App.Static {
		t.Fatal("a node artifact is not a static site")
	}
	if res.App.Port == 0 {
		t.Fatal("a process app still needs a port")
	}
	envPath := filepath.Join(root, "apps", "demo", "production", ".env")
	if _, err := os.Stat(envPath); err != nil {
		t.Fatalf("a process app still needs its .env, got: %v", err)
	}
}
