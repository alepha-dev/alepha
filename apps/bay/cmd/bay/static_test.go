package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alepha/bay/internal/health"
	"github.com/alepha/bay/internal/state"
)

// staticArtifact writes the tar.gz `alepha build --target=static` produces:
// a manifest with no entry point to spawn, and the prerendered files under
// dist/public.
func staticArtifact(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "static.tar.gz")
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	files := map[string]string{
		"dist/manifest.json":     `{"project": "demo", "runtime": "static"}`,
		"dist/public/index.html": "<html>home</html>",
		"dist/public/404.html":   "<html>missing</html>",
	}
	for name, body := range files {
		hdr := &tar.Header{Name: name, Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(body))}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestStaticDeploySpawnsNoProcess(t *testing.T) {
	// The point of the whole change. There is no entry point in the artifact, so
	// a supervisor asked to start one would fail — and the only message would be
	// "never became ready", which says nothing about why.
	f := newDeployFixture(t)

	_, failure := f.deploy(staticArtifact(t))

	if failure != nil {
		t.Fatalf("deploying a static site should succeed, got: %v", failure.Err)
	}
	if f.runner.starts != 0 {
		t.Fatalf("a static site has nothing to start, got %d start(s)", f.runner.starts)
	}
}

func TestStaticDeployNeedsNoRuntimeInstalled(t *testing.T) {
	// A host that has never hosted a node app can still serve a static site.
	// Resolving an interpreter first would make the deploy depend on one being
	// installed to run a thing that never runs.
	f := newDeployFixture(t)
	if err := os.RemoveAll(filepath.Join(f.root, "runtimes")); err != nil {
		t.Fatal(err)
	}

	_, failure := f.deploy(staticArtifact(t))

	if failure != nil {
		t.Fatalf("a static site needs no runtime, got: %v", failure.Err)
	}
}

func TestStaticDeployIsServedImmediately(t *testing.T) {
	// Readiness for a static site is the release switch itself: the files are on
	// disk and the proxy reads them. Probing a port nothing listens on would
	// fail every deploy after `readyTimeout`.
	f := newDeployFixture(t)

	outcome, failure := f.deploy(staticArtifact(t))

	if failure != nil {
		t.Fatalf("deploy failed: %v", failure.Err)
	}
	if outcome == nil {
		t.Fatal("a successful deploy should report an outcome")
	}
	app, ok := f.server.store.Get("demo/production")
	if !ok {
		t.Fatal("demo/production should be registered")
	}
	if !app.Static {
		t.Fatal("the stored app should be marked static")
	}
}

func TestStaticAppIsNotProbedForHealth(t *testing.T) {
	// A static app answers no /health, because nothing is listening. Left in the
	// watch loop it would be marked unhealthy forever — a permanent, wrong
	// warning, which is how operators learn to ignore warnings.
	f := newDeployFixture(t)
	// A probe that fails if it is used at all, standing in for the closed port a
	// static app leaves behind.
	f.server.probe = &health.Probe{Client: &http.Client{Transport: refusedTransport{}}}

	_, failure := f.deploy(staticArtifact(t))

	if failure != nil {
		t.Fatalf("a static site must not be health-probed, got: %v", failure.Err)
	}
}

func TestStaticAppIsNotWatchedForRollback(t *testing.T) {
	/*
		The watch arms on every REDEPLOY, so this only bites the second time an
		operator ships a static site — which is the worst possible moment for it.

		Nothing is listening, so the probe fails three times in a row and the
		verdict is "unhealthy". The watch then rolls back a release that is
		serving every request off disk perfectly well, and the operator sees
		their deploy silently revert with the app apparently fine.
	*/
	f := newDeployFixture(t)
	f.server.probe = &health.Probe{Client: &http.Client{Transport: refusedTransport{}}}
	if _, failure := f.deploy(staticArtifact(t)); failure != nil {
		t.Fatal(failure.Err)
	}
	app, ok := f.server.store.Get("demo/production")
	if !ok {
		t.Fatal("demo/production should be registered")
	}

	done := make(chan struct{})
	go func() {
		f.server.watchAndRollback(app, "an-earlier-release")
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("a static app must not be watched: there is no port to probe, so the window can only ever end in rolling back a healthy release")
	}
}

func TestStaticAppIsNotReportedAsNotRunning(t *testing.T) {
	// Nothing supervises a static site, so `Running` is false for it forever.
	// Reported as "not running" it makes `bay status` exit non-zero on a host
	// where everything is fine — and a status command that always fails is one
	// nobody reads, including on the day something is actually wrong.
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	apps := []listedApp{{
		App: state.App{Name: "docs", Env: "production", Release: "r1", Static: true},
	}}

	if err := printStatusJSON(apps, now, 24*time.Hour); err != nil {
		t.Fatalf("a static app is serving, not broken; got: %v", err)
	}
}

func TestAProcessAppThatIsNotRunningIsStillAProblem(t *testing.T) {
	// The guard rail on the exemption above.
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	apps := []listedApp{{
		App: state.App{Name: "lore", Env: "production", Release: "r1", Port: 4001},
	}}

	if err := printStatusJSON(apps, now, 24*time.Hour); err == nil {
		t.Fatal("a process app that is not running must still be reported")
	}
}

// refusedTransport errors on every request, the way dialling a port nothing
// bound does.
type refusedTransport struct{}

func (refusedTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("connection refused")
}
