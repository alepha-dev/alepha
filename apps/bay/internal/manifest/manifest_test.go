package manifest

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// write lays out an unpacked release containing only `manifest.json` and
// returns the release directory, so the tests exercise the same path resolution
// the deployer uses. At the ROOT: the archive root is the contents, not a
// `dist/` wrapper.
func write(t *testing.T, body string) string {
	t.Helper()
	release := t.TempDir()
	if err := os.WriteFile(filepath.Join(release, "manifest.json"), []byte(body), 0o600); err != nil {
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
		"entry": "index.node.js",
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
		"entry": "index.node.js",
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
	_, err := read(t, `{"project":"a","runtime":"node","entry":"index.node.js","runtimeVersion":"26.5.0"}`)
	if err == nil {
		t.Fatal("expected an exact version pin to be rejected")
	}
	if !strings.Contains(err.Error(), "major") {
		t.Fatalf("error should point at declaring a major, got: %v", err)
	}
}

func TestAcceptsMajorPin(t *testing.T) {
	m, err := read(t, `{"project":"a","runtime":"node","entry":"index.node.js","runtimeVersion":"26"}`)
	if err != nil {
		t.Fatal(err)
	}
	if m.RuntimeVersion != "26" {
		t.Fatalf("got %q", m.RuntimeVersion)
	}
}

func TestDefaultsRuntimeToNode(t *testing.T) {
	// Artifacts built before `runtime` existed carry none. Node is what the
	// framework's build defaults to, so that is the honest reading.
	m, err := read(t, `{"project":"a","entry":"index.node.js"}`)
	if err != nil {
		t.Fatal(err)
	}
	if m.Runtime != "node" {
		t.Fatalf("runtime default should be node, got %q", m.Runtime)
	}
}

// ⚠️ `entry` has no default anymore. It used to fall back to `dist`, the
// directory the old archive wrapped everything in; the archive root is now the
// contents, so that default names a directory that is not there and `node dist`
// fails as "never became ready" — a message about nothing.
func TestRefusesAnArtifactThatNamesNoEntry(t *testing.T) {
	_, err := read(t, `{"project":"a","runtime":"node"}`)
	if err == nil {
		t.Fatal("expected an artifact with no entry to be refused")
	}
	if !strings.Contains(err.Error(), "names no entry file") {
		t.Fatalf("error should say the entry is missing, got: %v", err)
	}
}

// The multi-slice artifact (epic #E63). Order is the decision and Bay applies
// no preference of its own.
func TestTakesTheFirstRunnableSliceInDeclaredOrder(t *testing.T) {
	m, err := read(t, `{
		"project": "lore",
		"runtime": "node",
		"entry": "index.node.js",
		"runtimes": [
			{"runtime": "node", "entry": "index.node.js"},
			{"runtime": "bun", "entry": "index.bun.js"}
		]
	}`)
	if err != nil {
		t.Fatal(err)
	}
	if m.Runtime != "node" || m.Entry != "index.node.js" {
		t.Fatalf("(node,bun) must spawn node, got %q %q", m.Runtime, m.Entry)
	}
}

func TestNeverReordersTheSlices(t *testing.T) {
	// The same two slices, declared the other way round, must spawn the other
	// one. A preference of Bay's own would make this case indistinguishable
	// from the one above.
	m, err := read(t, `{
		"project": "lore",
		"runtime": "bun",
		"entry": "index.bun.js",
		"runtimes": [
			{"runtime": "bun", "entry": "index.bun.js"},
			{"runtime": "node", "entry": "index.node.js"}
		]
	}`)
	if err != nil {
		t.Fatal(err)
	}
	if m.Runtime != "bun" || m.Entry != "index.bun.js" {
		t.Fatalf("(bun,node) must spawn bun, got %q %q", m.Runtime, m.Entry)
	}
}

func TestSkipsASliceItCannotRun(t *testing.T) {
	// A node+workerd artifact is the common one: workerd is declared first
	// because Cloudflare is the primary target, and Bay still has a slice.
	m, err := read(t, `{
		"project": "lore",
		"runtime": "workerd",
		"entry": "index.workerd.js",
		"runtimes": [
			{"runtime": "workerd", "entry": "index.workerd.js"},
			{"runtime": "node", "entry": "index.node.js"}
		]
	}`)
	if err != nil {
		t.Fatal(err)
	}
	if m.Runtime != "node" || m.Entry != "index.node.js" {
		t.Fatalf("Bay should fall through workerd to node, got %q %q", m.Runtime, m.Entry)
	}
}

func TestRefusesAWorkerdOnlyArtifactByName(t *testing.T) {
	// Nothing runnable is declared, so the refusal must still name what the
	// artifact IS rather than say "no runnable slice".
	_, err := read(t, `{
		"project": "lore",
		"runtime": "workerd",
		"entry": "index.workerd.js",
		"runtimes": [{"runtime": "workerd", "entry": "index.workerd.js"}]
	}`)
	if err == nil {
		t.Fatal("expected a workerd-only artifact to be refused")
	}
	if !strings.Contains(err.Error(), "Cloudflare Workers") {
		t.Fatalf("error should name Cloudflare, got: %v", err)
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

func TestAcceptsStaticArtifact(t *testing.T) {
	// A site built with `--target=static` has no entry point to spawn. Bay
	// serves it from disk and starts nothing, so `static` is a legitimate answer
	// to "what must a deployer do to run this artifact".
	m, err := read(t, `{"project":"docs","runtime":"static"}`)
	if err != nil {
		t.Fatal(err)
	}
	if !m.IsStatic() {
		t.Fatal("a static artifact should report IsStatic")
	}
}

func TestServerRuntimesAreNotStatic(t *testing.T) {
	for _, runtime := range []string{"node", "bun"} {
		m, err := read(t, `{"project":"a","runtime":"`+runtime+`","entry":"index.`+runtime+`.js"}`)
		if err != nil {
			t.Fatal(err)
		}
		if m.IsStatic() {
			t.Fatalf("%s is a process runtime, not a static site", runtime)
		}
	}
}

func TestStaticArtifactNeedsNoRuntimeVersion(t *testing.T) {
	// Nothing is spawned, so there is no interpreter to resolve a major against.
	// A static artifact omitting the field must not trip the pin validator.
	if _, err := read(t, `{"project":"docs","runtime":"static"}`); err != nil {
		t.Fatalf("a static artifact without runtimeVersion should load, got: %v", err)
	}
}

func TestRejectsStaticArtifactDeclaringResources(t *testing.T) {
	// Nothing runs, so nothing can open a database or a bucket. Refusing here
	// names the contradiction at deploy time; accepting it would provision a
	// database no process will ever connect to.
	for _, resource := range []string{"hasDatabase", "hasBucket", "hasKV", "hasQueue"} {
		body := `{"project":"docs","runtime":"static","resources":{"` + resource + `":true}}`
		_, err := read(t, body)
		if err == nil {
			t.Fatalf("expected a static artifact declaring %s to be rejected", resource)
		}
		if !strings.Contains(err.Error(), "static") {
			t.Fatalf("error should name the static runtime, got: %v", err)
		}
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
		t.Fatal("expected a release without manifest.json to be rejected")
	}
}

func TestLegacyReleaseNamesTheMigration(t *testing.T) {
	// A release unpacked before the archive root became the contents keeps its
	// manifest under `dist/`. Without this the message is "read manifest: no
	// such file", which on a Bay restart surfaces as every app failing to come
	// back with no hint that a redeploy is what fixes it.
	release := t.TempDir()
	if err := os.MkdirAll(filepath.Join(release, "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(release, "dist", "manifest.json"),
		[]byte(`{"project":"lore","runtime":"node","entry":"dist"}`), 0o600,
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
