package deploy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alepha/bay/internal/state"
)

// artifact builds a minimal but valid deployable archive.
func artifact(t *testing.T, name string) string {
	t.Helper()
	return buildArchive(t,
		entry{name: "dist/manifest.json", body: `{
			"project": "` + name + `",
			"entry": "index.js",
			"runtime": "node"
		}`},
		entry{name: "dist/index.js", body: "process.exit(0)"},
	)
}

func runDeploy(t *testing.T, root string, store *state.Store, name string) *Result {
	t.Helper()
	res, err := Run(Options{
		Root:       root,
		Artifact:   artifact(t, name),
		Name:       name,
		Env:        "production",
		BaseDomain: "bay.test",
	}, store)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestFirstDeployHasNoPreviousRelease(t *testing.T) {
	// Nothing to roll back to, and saying so is what stops the caller from
	// rolling back to a release that never existed.
	root := t.TempDir()
	store, err := state.Open(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}

	res := runDeploy(t, root, store, "demo")

	if res.Previous != "" {
		t.Fatalf("a first deploy has no previous release, got %q", res.Previous)
	}
}

func TestRedeployReportsTheReleaseItReplaced(t *testing.T) {
	/*
		The bug this exists for.

		`Run` writes the new release into the store as part of its job, so a
		caller reading the store *after* it gets back the release being
		deployed — not the one being replaced. The first automatic-rollback
		implementation did exactly that: `previous` came back equal to the new
		release, the "is there something to roll back to" check compared them,
		found them equal, and skipped the watch on every single deploy.

		Nothing failed. No error, no log line. The feature was simply never
		armed, and it took deploying a deliberately broken release to a real
		host to notice. Returning the value from `Run`, where it is already
		known, removes the ordering the caller could get wrong.
	*/
	root := t.TempDir()
	store, err := state.Open(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}

	first := runDeploy(t, root, store, "demo")
	second := runDeploy(t, root, store, "demo")

	if second.Previous == "" {
		t.Fatal("a redeploy must report what it replaced, or rollback never arms")
	}
	if second.Previous == second.Release {
		t.Fatalf("previous must not be the release being deployed, both are %q",
			second.Release)
	}
	if second.Previous != first.Release {
		t.Fatalf("previous should be %q, got %q", first.Release, second.Previous)
	}
}

func TestPreviousIsNotAffectedByReadingTheStoreAfterwards(t *testing.T) {
	// States the trap directly: the store has already moved on by the time Run
	// returns, so the answer has to come from the result.
	root := t.TempDir()
	store, err := state.Open(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}

	runDeploy(t, root, store, "demo")
	second := runDeploy(t, root, store, "demo")

	stored, ok := store.Get("demo/production")
	if !ok {
		t.Fatal("the app should be registered")
	}
	if stored.Release != second.Release {
		t.Fatalf("the store holds the new release, got %q", stored.Release)
	}
	if stored.Release == second.Previous {
		t.Fatal("reading the store after Run cannot yield the previous release")
	}
}

func TestTwoDeploysInTheSameSecondBothSucceed(t *testing.T) {
	// A release name is second-resolution because an operator types it into
	// an incident note. Two deploys inside one second used to collide, and the
	// failure was a bare `rename: file exists` naming two temporary paths —
	// nothing about releases, nothing to act on.
	root := t.TempDir()
	store, err := state.Open(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}

	first := runDeploy(t, root, store, "demo")
	second := runDeploy(t, root, store, "demo")

	if first.Release == second.Release {
		t.Fatalf("two releases must not share a name, both are %q", first.Release)
	}
	if second.Previous != first.Release {
		t.Fatalf("previous should still be %q, got %q", first.Release, second.Previous)
	}
}

func TestDeployedAppsRunInProductionMode(t *testing.T) {
	/*
		The bundle already knows — `alepha build` substitutes the literal, so
		`isProduction()` is true either way and the shutdown drain is on.

		This is about the OS environment agreeing with it. Anything that reads
		`process.env.NODE_ENV` at runtime rather than through the bundle's
		substitution sees an unset variable and concludes development, which
		leaves half the process disagreeing with the other half.
	*/
	root := t.TempDir()
	store, err := state.Open(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}

	runDeploy(t, root, store, "demo")

	envPath := filepath.Join(root, "apps", "demo", "production", ".env")
	raw := flatEnv(t, envPath)
	if !strings.Contains(raw, "NODE_ENV=production") {
		t.Fatalf("a deployed app must run in production mode, .env was:\n%s", raw)
	}
}

func TestBayReclaimsNodeEnvFromAnAppThatOverrodeIt(t *testing.T) {
	// User keys in a .env survive a redeploy untouched — that is the rule that
	// stops Bay wiping STRIPE_KEY. NODE_ENV is the exception: it describes what
	// Bay is doing, not what the app prefers, and a stale "development" left in
	// a .env would put the runtime environment at odds with the bundle.
	root := t.TempDir()
	store, err := state.Open(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}

	runDeploy(t, root, store, "demo")

	envPath := filepath.Join(root, "apps", "demo", "production", ".env")
	if err := os.WriteFile(envPath,
		[]byte("NODE_ENV=development\nSTRIPE_KEY=sk_live_keepme\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	runDeploy(t, root, store, "demo")

	raw := flatEnv(t, envPath)
	if strings.Contains(raw, "NODE_ENV=development") {
		t.Error("Bay must reclaim NODE_ENV — it describes the deployment, not a preference")
	}
	if !strings.Contains(raw, "STRIPE_KEY=sk_live_keepme") {
		t.Error("a user's own key must survive a redeploy")
	}
}

// A pruned release name must never be handed to a later deploy.
//
// The bug this reproduces: at second precision, two deploys inside one second
// collided and `uniqueRelease` resolved it with a `-2` suffix. That still
// sorted correctly — until retention deleted the bare name and FREED it. The
// next deploy took the name back, and the newest release then sorted as the
// OLDEST, because "X" is a prefix of "X-2" and therefore lexically smaller.
//
// `Releases` promises newest-first and `Prune` reads that order to choose what
// to delete, so an inversion points retention at the wrong end of the list.
//
// The deletion below is what retention does; the assertion is that the name
// does not come back around.
func TestAPrunedReleaseNameIsNotReused(t *testing.T) {
	root, store := newRoot(t)
	instance := filepath.Join(root, "apps", "demo", "production")

	deployOnce := func() string {
		t.Helper()
		res, err := Run(Options{
			Root: root, Artifact: artifact(t, "demo"), Name: "demo",
			Env: "production", BaseDomain: "bay.test",
		}, store)
		if err != nil {
			t.Fatal(err)
		}
		return res.Release
	}

	first := deployOnce()
	second := deployOnce()

	// Retention deletes the oldest, freeing its name.
	if err := os.RemoveAll(filepath.Join(instance, "releases", first)); err != nil {
		t.Fatal(err)
	}

	third := deployOnce()
	if third == first {
		t.Fatalf("a deleted release name was handed out again (%q); the newest release "+
			"would then sort as the oldest and retention reads that order", third)
	}
	if third <= second {
		t.Fatalf("release %q must sort after %q — newest-first ordering depends on it",
			third, second)
	}

	listed, err := Releases(instance)
	if err != nil {
		t.Fatal(err)
	}
	if listed[0] != third {
		t.Fatalf("newest first: want %q at the head, got %v", third, listed)
	}
}
