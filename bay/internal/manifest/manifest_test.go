package manifest

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// write lays out an unpacked release containing only `dist/manifest.json` and
// returns the release directory, so the tests exercise the same path resolution
// the deployer uses.
func write(t *testing.T, body string) string {
	t.Helper()
	release := t.TempDir()
	dist := filepath.Join(release, "dist")
	if err := os.MkdirAll(dist, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dist, "manifest.json"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return release
}

// read lays out a release from a manifest body and loads it.
func read(t *testing.T, body string) (*Manifest, error) {
	t.Helper()
	return LoadFromRelease(write(t, body))
}

func TestReadsTheFrameworkBuildManifest(t *testing.T) {
	// This is the shape `alepha build` actually emits. Bay reads the framework's
	// own artifact contract rather than a Bay-specific manifest, so declaring
	// `$repository` in app code is what provisions the database — nobody has to
	// say it a second time by hand.
	m, err := read(t, `{
		"version": 1,
		"project": "lore",
		"defaultEnv": "production",
		"environments": {},
		"runtime": "node",
		"runtimeVersion": "26",
		"entry": "dist",
		"resources": {
			"hasDatabase": true,
			"hasBucket": true,
			"hasKV": false,
			"hasQueue": false,
			"hasCron": true,
			"hasWebSocket": false
		},
		"crons": ["0 3 * * *"],
		"websocketPaths": [],
		"env": ["APP_SECRET"]
	}`)
	if err != nil {
		t.Fatal(err)
	}
	if m.Name != "lore" {
		t.Fatalf("name should come from `project`, got %q", m.Name)
	}
	if !m.Resources.Database || !m.Resources.Bucket {
		t.Fatalf("resources should map from the has* wire names, got %+v", m.Resources)
	}
	if m.Resources.KV || m.Resources.Queue {
		t.Fatalf("undeclared resources must stay false, got %+v", m.Resources)
	}
	if len(m.Cron) != 1 {
		t.Fatalf("crons should map to Cron, got %v", m.Cron)
	}
}

func TestIgnoresFieldsMeantForOtherConsumers(t *testing.T) {
	// `environments`, `tenancy`, `websocketPaths`, `email` and `env` belong to
	// the Cloudflare/Rocket deploy paths. A newer build adding more of them must
	// not break an older Bay.
	if _, err := read(t, `{
		"project": "lore",
		"tenancy": "optional",
		"environments": {"production": {"adapter": "cloudflare"}},
		"email": {"binding": "SEND_EMAIL"},
		"somethingAddedLater": {"deeply": ["nested"]}
	}`); err != nil {
		t.Fatalf("unknown fields should be ignored, got: %v", err)
	}
}

func TestRejectsExactVersionPin(t *testing.T) {
	// An exact pin recreates the very problem Bay owning the runtime solves:
	// patching a CVE would need a rebuild and a redeploy per app.
	_, err := read(t, `{"project":"a","runtime":"node","runtimeVersion":"26.5.0"}`)
	if err == nil {
		t.Fatal("expected an exact version pin to be rejected")
	}
	if !strings.Contains(err.Error(), "major") {
		t.Fatalf("error should point at declaring a major, got: %v", err)
	}
}

func TestAcceptsMajorPin(t *testing.T) {
	m, err := read(t, `{"project":"a","runtime":"node","runtimeVersion":"26"}`)
	if err != nil {
		t.Fatal(err)
	}
	if m.RuntimeVersion != "26" {
		t.Fatalf("got %q", m.RuntimeVersion)
	}
}

func TestDefaults(t *testing.T) {
	// Artifacts built before `runtime`/`entry` existed carry neither.
	m, err := read(t, `{"project":"a"}`)
	if err != nil {
		t.Fatal(err)
	}
	if m.Runtime != "node" {
		t.Fatalf("runtime default should be node, got %q", m.Runtime)
	}
	if m.Entry != "dist" {
		t.Fatalf("entry default should be dist, got %q", m.Entry)
	}
}

func TestRejectsWorkerdArtifact(t *testing.T) {
	// A Cloudflare-targeted bundle is resolved against workerd export
	// conditions and has no node-runnable entry point. Caught here it names the
	// fix; caught three steps later it only says "never became ready".
	_, err := read(t, `{"project":"a","runtime":"workerd"}`)
	if err == nil {
		t.Fatal("expected a workerd artifact to be rejected")
	}
	if !strings.Contains(err.Error(), "--target=bare") {
		t.Fatalf("error should name the rebuild flag, got: %v", err)
	}
}

func TestRejectsUnknownRuntime(t *testing.T) {
	if _, err := read(t, `{"project":"a","runtime":"deno"}`); err == nil {
		t.Fatal("expected unknown runtime to be rejected")
	}
}

func TestRejectsMissingProject(t *testing.T) {
	// The domain is composed from the name, so an artifact without one cannot be
	// placed on a host at all.
	if _, err := read(t, `{}`); err == nil {
		t.Fatal("expected a manifest with no project name to be rejected")
	}
}

func TestMissingManifestIsAnError(t *testing.T) {
	// An artifact that is not an Alepha build must fail here, loudly, rather
	// than deploy into a process that cannot start.
	if _, err := LoadFromRelease(t.TempDir()); err == nil {
		t.Fatal("expected a release without dist/manifest.json to be rejected")
	}
}

func TestSleepEligibility(t *testing.T) {
	// An app with crons runs them in-process; sleeping it would silently stop
	// them. The manifest makes that decidable without Bay parsing cron at all.
	withCron, err := read(t, `{"project":"a","crons":["0 3 * * *"]}`)
	if err != nil {
		t.Fatal(err)
	}
	if withCron.SleepEligible() {
		t.Fatal("an app declaring crons must never be scaled to zero")
	}

	without, err := read(t, `{"project":"a","crons":[]}`)
	if err != nil {
		t.Fatal(err)
	}
	if !without.SleepEligible() {
		t.Fatal("an app without crons should be sleep eligible")
	}
}

func TestSubdomainComposition(t *testing.T) {
	m, err := read(t, `{"project":"lore"}`)
	if err != nil {
		t.Fatal(err)
	}
	// Production reads well bare; anything else is suffixed, so staging never
	// collides with production on the same base domain.
	if got := m.Subdomain("production"); got != "lore" {
		t.Fatalf("production should be bare, got %q", got)
	}
	if got := m.Subdomain(""); got != "lore" {
		t.Fatalf("empty env should behave as production, got %q", got)
	}
	if got := m.Subdomain("staging"); got != "lore-staging" {
		t.Fatalf("got %q", got)
	}
}

func TestLegacyReleaseNamesTheMigration(t *testing.T) {
	// A release unpacked by an older Bay has a hand-written manifest at the
	// archive root. Without this the message is "read manifest: no such file",
	// which on a Bay restart surfaces as every app failing to come back with no
	// hint that a redeploy is what fixes it.
	release := t.TempDir()
	if err := os.WriteFile(
		filepath.Join(release, "manifest.json"),
		[]byte(`{"name":"lore","runtime":"node"}`), 0o600,
	); err != nil {
		t.Fatal(err)
	}

	_, err := LoadFromRelease(release)
	if err == nil {
		t.Fatal("expected a legacy release to be rejected")
	}
	if !strings.Contains(err.Error(), "redeploy") {
		t.Fatalf("error should name the fix, got: %v", err)
	}
}
