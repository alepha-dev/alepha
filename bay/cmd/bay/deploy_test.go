package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alepha/bay/internal/health"
	"github.com/alepha/bay/internal/runner"
	"github.com/alepha/bay/internal/state"
)

// fakeRunner supervises nothing and remembers everything.
//
// The deploy sequence is what these tests are about, and a real supervisor would
// make them depend on systemd, on a node binary and on a process that can be
// made to crash on command. What the sequence actually needs to know is "is this
// app running" — which is exactly what a map answers.
type fakeRunner struct {
	mu      sync.Mutex
	running map[string]bool
	starts  int
	// refuseStart decides whether the nth Start (1-based) fails, so a test can
	// have a release that will not boot without needing a process at all.
	refuseStart func(n int) error
	// lastSpec is what the supervisor was last asked to run. The sandbox is
	// decided here and nowhere else, so this is the only place a test can see
	// which paths an app was actually granted.
	lastSpec runner.Spec
	// removes records every Remove call, so a test can assert that removing an
	// app uninstalls it and whether the purge flag was carried through.
	removes []removeCall
}

// removeCall is one `Remove(key, purge)` the server made.
type removeCall struct {
	key   string
	purge bool
}

func newFakeRunner() *fakeRunner { return &fakeRunner{running: map[string]bool{}} }

func (f *fakeRunner) Start(spec runner.Spec) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.starts++
	f.lastSpec = spec
	if f.refuseStart != nil {
		if err := f.refuseStart(f.starts); err != nil {
			return err
		}
	}
	f.running[spec.Key] = true
	return nil
}

func (f *fakeRunner) Stop(key string, _ time.Duration) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.running[key] = false
	return nil
}

func (f *fakeRunner) Remove(key string, purge bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.removes = append(f.removes, removeCall{key: key, purge: purge})
	delete(f.running, key)
	return nil
}

func (f *fakeRunner) Running(key string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.running[key]
}

func (f *fakeRunner) State(key string) string {
	if f.Running(key) {
		return "active"
	}
	return "inactive"
}

func (f *fakeRunner) StopAll(time.Duration)                            {}
func (f *fakeRunner) Usage(string) (runner.Usage, bool)                { return runner.Usage{}, false }
func (f *fakeRunner) Logs(string, int) ([]runner.LogLine, bool, error) { return nil, false, nil }

// readyTransport answers every /health with ready.
//
// `health.Probe` takes its own client precisely so it can be pointed elsewhere;
// nothing in the deploy sequence under test depends on a socket being open, and
// binding the port the store happened to allocate would only add a race.
type readyTransport struct{}

func (readyTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(`{"ready":true}`)),
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Request:    req,
	}, nil
}

// deployFixture is a server with a real root, a real store and a real filesystem
// — only the supervisor and the probe are stand-ins.
type deployFixture struct {
	server *server
	runner *fakeRunner
	root   string
}

func newDeployFixture(t *testing.T) *deployFixture {
	t.Helper()
	root := t.TempDir()
	store, err := state.Open(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetBaseDomain("bay.test"); err != nil {
		t.Fatal(err)
	}

	// A runtime Bay owns, so `runtimes.Resolve` never falls through to whatever
	// the machine running the tests happens to have on PATH.
	bin := filepath.Join(root, "runtimes", "node-24", "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, "node"), []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	r := newFakeRunner()
	return &deployFixture{
		root:   root,
		runner: r,
		server: &server{
			root:     root,
			runtimes: filepath.Join(root, "runtimes"),
			store:    store,
			runner:   r,
			probe:    &health.Probe{Client: &http.Client{Transport: readyTransport{}}},
			log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
			// Built the way `serve` builds it. Left at zero the fixture prunes
			// nothing, so a test could not tell retention working from
			// retention never running.
			keepReleases: defaultKeepReleases,
		},
	}
}

// deploy runs the real sequence, the one both the control API and the command
// loop go through.
func (f *deployFixture) deploy(artifact string) (*deployOutcome, *deployFailure) {
	return f.server.deployArtifact(context.Background(), deployArtifactOptions{
		Artifact: artifact, Name: "demo", Env: "production",
	})
}

// currentRelease is what the `current` symlink resolves to on disk — the release
// the app would boot from right now, whatever the store says.
func (f *deployFixture) currentRelease(t *testing.T) string {
	t.Helper()
	resolved, err := filepath.EvalSymlinks(
		filepath.Join(f.root, "apps", "demo", "production", "current"))
	if err != nil {
		t.Fatal(err)
	}
	return filepath.Base(resolved)
}

func (f *deployFixture) storedRelease(t *testing.T) string {
	t.Helper()
	app, ok := f.server.store.Get("demo/production")
	if !ok {
		t.Fatal("demo/production should be registered")
	}
	return app.Release
}

// deployableArtifact writes the smallest tar.gz `deploy.Run` accepts.
func deployableArtifact(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "artifact.tar.gz")
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	files := map[string]string{
		"dist/manifest.json": `{
			"project": "demo",
			"entry": "index.js",
			"runtime": "node",
			"runtimeVersion": "24"
		}`,
		"dist/index.js": "process.exit(0)",
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

// refusedArtifact writes a gzip stream that is not a tar.
//
// The exact shape of the artifact that took example-api down: gzip opens fine,
// so the failure lands inside `untar` — after the running app has been stopped
// and before anything in the instance directory has been touched.
func refusedArtifact(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "refused.tar.gz")
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write([]byte("this is gzip, but it is not a tar")); err != nil {
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

func TestARefusedArtifactLeavesTheAppRunning(t *testing.T) {
	/*
		The bug, reproduced end to end on ovh-bay on 2026-08-03.

		`deployArtifact` stops the running process before unpacking, because
		`current` has to be swapped out from under it. An artifact the unpacker
		refused then returned straight to the caller — leaving the app stopped,
		with its previous release intact on disk and `current` still pointing at
		it. One redeploy of a good artifact brought it back.

		What made it expensive is that the failure report was accurate and
		reassuring. The release went `failed` with "deploy: unpack: read archive:
		unexpected EOF", which reads as "nothing changed on the host" — and the
		site was 502 until somebody noticed. A CI pipeline deploying over SSH
		reads the same terse response and moves on: a broken artifact takes
		production down with no human watching in real time either.
	*/
	f := newDeployFixture(t)
	first, derr := f.deploy(deployableArtifact(t))
	if derr != nil {
		t.Fatalf("the first deploy should succeed: %v", derr)
	}
	if !f.runner.Running("demo/production") {
		t.Fatal("the app should be serving before the bad deploy")
	}

	out, derr := f.deploy(refusedArtifact(t))

	if derr == nil {
		t.Fatal("a gzip that is not a tar must be refused")
	}
	if out != nil {
		t.Fatal("a refused artifact has no outcome to report")
	}
	if !f.runner.Running("demo/production") {
		t.Fatal("a refused artifact must not leave the app stopped — its release never moved")
	}
	if got := f.storedRelease(t); got != first.Result.Release {
		t.Fatalf("the store should still hold %q, got %q", first.Result.Release, got)
	}
	if got := f.currentRelease(t); got != first.Result.Release {
		t.Fatalf("current should still point at %q, got %q", first.Result.Release, got)
	}
	// The sentence is for a person; this is for whatever is deciding whether to
	// page one. Reading a message to find out if the site is up does not scale.
	if got := derr.Detail["running"]; got != true {
		t.Fatalf("the caller must be told the app is serving, got %v", got)
	}
}

func TestARefusedArtifactSaysWhenTheAppCouldNotBeRestartedEither(t *testing.T) {
	/*
		"The deploy failed" and "the deploy failed AND the site is down" are two
		different sentences, and only the second one should wake somebody up.

		An operator who reads the first about an app that is actually down learns
		to distrust the report; one who reads it about an app that came back
		correctly has nothing to do. So the escalation has to be in the error
		itself — the status too, because a 400 tells CI "your build is bad" and
		says nothing about the host.
	*/
	f := newDeployFixture(t)
	if _, derr := f.deploy(deployableArtifact(t)); derr != nil {
		t.Fatalf("the first deploy should succeed: %v", derr)
	}
	f.runner.refuseStart = func(int) error { return errAlwaysRefused }

	_, derr := f.deploy(refusedArtifact(t))

	if derr == nil {
		t.Fatal("a gzip that is not a tar must be refused")
	}
	if derr.Status != http.StatusBadGateway {
		t.Fatalf("an app left down is a host problem, want 502, got %d", derr.Status)
	}
	msg := derr.Error()
	if !strings.Contains(msg, "unpack") {
		t.Fatalf("the artifact's own failure must survive, got %q", msg)
	}
	if !strings.Contains(msg, "DOWN") {
		t.Fatalf("the message must say the app is down, got %q", msg)
	}
	if !strings.Contains(msg, errAlwaysRefused.Error()) {
		t.Fatalf("the restart's failure must be named too, got %q", msg)
	}
	// Both causes stay wrapped rather than flattened into a sentence, so a
	// caller can still match on either one.
	if !errors.Is(derr, errAlwaysRefused) {
		t.Fatal("the restart failure must remain reachable with errors.Is")
	}
}

func TestARefusedArtifactDoesNotStartAnAppThatWasStopped(t *testing.T) {
	// `bay stop` is a decision, and a deploy that failed is not a reason to undo
	// it. The repair puts back what was there — which for a stopped app is
	// nothing at all.
	f := newDeployFixture(t)
	if _, derr := f.deploy(deployableArtifact(t)); derr != nil {
		t.Fatalf("the first deploy should succeed: %v", derr)
	}
	if err := f.runner.Stop("demo/production", 0); err != nil {
		t.Fatal(err)
	}

	_, derr := f.deploy(refusedArtifact(t))

	if derr == nil {
		t.Fatal("a gzip that is not a tar must be refused")
	}
	if f.runner.Running("demo/production") {
		t.Fatal("a failed deploy must not start an app somebody had stopped")
	}
	if derr.Status != http.StatusBadRequest {
		t.Fatalf("nothing changed on the host, want 400, got %d", derr.Status)
	}
	if got := derr.Detail["running"]; got != false {
		t.Fatalf("the app was not serving and still is not, got %v", got)
	}
}

func TestAReleaseThatNeverBecomesReadyIsRolledBack(t *testing.T) {
	/*
		The case one line below the refused artifact, and `watchAndRollback` does
		not cover it: that watch is only armed once `start` has returned
		successfully, so a release that never becomes ready has nothing watching
		it. By then `current` and the store both name the new release, the process
		is not running, and no timer will ever put it back — the app would stay
		down until somebody noticed, which on a CI-driven deploy is the problem
		rather than the fix.

		This is the ONLY rollback Bay performs. There is no manual one: the
		artifacts live in Lore, so going further back than the release that was
		serving a moment ago is a redeploy, not a Bay operation.
	*/
	f := newDeployFixture(t)
	first, derr := f.deploy(deployableArtifact(t))
	if derr != nil {
		t.Fatalf("the first deploy should succeed: %v", derr)
	}
	// The second start is the new release's; the third is the rollback's.
	f.runner.refuseStart = func(n int) error {
		if n == 2 {
			return errAlwaysRefused
		}
		return nil
	}

	out, derr := f.deploy(deployableArtifact(t))

	if derr == nil {
		t.Fatal("a release that never becomes ready is a failed deploy")
	}
	if out != nil {
		t.Fatal("a failed deploy has no outcome to report")
	}
	if got := f.currentRelease(t); got != first.Result.Release {
		t.Fatalf("current should be back on %q, got %q", first.Result.Release, got)
	}
	if got := f.storedRelease(t); got != first.Result.Release {
		t.Fatalf("the store should be back on %q, got %q", first.Result.Release, got)
	}
	if !f.runner.Running("demo/production") {
		t.Fatal("the release that worked must be serving again")
	}
	if got := derr.Detail["rolledBackTo"]; got != first.Result.Release {
		t.Fatalf("the caller must be told what is serving now, got %v", got)
	}
}

func TestAReleaseThatNeverBecomesReadySaysWhenTheRollbackFailedToo(t *testing.T) {
	// Both halves broken: the new release will not boot and neither will the old
	// one. Nothing automatic is left, so the error has to be the one that gets
	// somebody out of bed.
	f := newDeployFixture(t)
	if _, derr := f.deploy(deployableArtifact(t)); derr != nil {
		t.Fatalf("the first deploy should succeed: %v", derr)
	}
	f.runner.refuseStart = func(n int) error {
		if n >= 2 {
			return errAlwaysRefused
		}
		return nil
	}

	_, derr := f.deploy(deployableArtifact(t))

	if derr == nil {
		t.Fatal("a release that never becomes ready is a failed deploy")
	}
	if derr.Status != http.StatusBadGateway {
		t.Fatalf("want 502, got %d", derr.Status)
	}
	msg := derr.Error()
	if !strings.Contains(msg, "DOWN") {
		t.Fatalf("the message must say the app is down, got %q", msg)
	}
	if f.runner.Running("demo/production") {
		t.Fatal("the fixture is wrong: nothing should be running here")
	}
}

// errAlwaysRefused stands in for whatever the supervisor says when it will not
// start an app — a full disk, a systemd unit that will not load.
var errAlwaysRefused = errors.New("supervisor refused to start the unit")

// Bay keeps the release it serves and the one before it. Nothing else.
//
// Not a depth setting — the number the two readers of the releases directory
// actually need. The automatic rollback consults exactly one predecessor, and
// the proxy serves static files from every retained release so a client holding
// the previous page's HTML can still fetch its hashed chunks through a deploy.
// That is a one-deploy window.
//
// Bay is not an archive: Lore holds the artifacts, so history kept here is both
// duplicated and unrecoverable — the premise is that this host can be destroyed
// and rebuilt, and anything stored only here is what makes that false. Measured
// on the real host, five releases of one app was 245 MB.
func TestOnlyTheServingReleaseAndItsPredecessorAreKept(t *testing.T) {
	f := newDeployFixture(t)

	var releases []string
	for range 4 {
		out, derr := f.deploy(deployableArtifact(t))
		if derr != nil {
			t.Fatalf("deploy failed: %v", derr)
		}
		releases = append(releases, out.Result.Release)
	}

	entries, err := os.ReadDir(filepath.Join(f.root, "apps", "demo", "production", "releases"))
	if err != nil {
		t.Fatal(err)
	}
	var kept []string
	for _, e := range entries {
		kept = append(kept, e.Name())
	}
	if len(kept) != 2 {
		t.Fatalf("after four deploys exactly two releases should remain, got %d: %v", len(kept), kept)
	}

	// And they must be the right two: the one being served, and the one the
	// automatic rollback would fall back to.
	current, previous := releases[3], releases[2]
	for _, want := range []string{current, previous} {
		found := false
		for _, k := range kept {
			if k == want {
				found = true
			}
		}
		if !found {
			t.Fatalf("expected %q to be kept, got %v", want, kept)
		}
	}
}

// TestArtifactBodyReadsStdinForDash covers the seam `bay deploy -` needs.
//
// A path is opened; `-` is not. Getting this wrong is silent: `os.Open("-")`
// fails with "no such file", which reads like a typo rather than like a
// missing feature.
func TestArtifactBodyReadsStdinForDash(t *testing.T) {
	body, closer, err := artifactBody("-", strings.NewReader("from-stdin"))
	if err != nil {
		t.Fatal(err)
	}
	defer closer()

	got, err := io.ReadAll(body)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "from-stdin" {
		t.Fatalf("body = %q, want %q", got, "from-stdin")
	}
}

func TestArtifactBodyOpensAPath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.tar.gz")
	if err := os.WriteFile(path, []byte("from-disk"), 0o644); err != nil {
		t.Fatal(err)
	}

	body, closer, err := artifactBody(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer closer()

	got, err := io.ReadAll(body)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "from-disk" {
		t.Fatalf("body = %q, want %q", got, "from-disk")
	}
}

func TestArtifactBodyReportsAMissingFile(t *testing.T) {
	// Not swallowed into an empty body: an unreadable artifact must fail before
	// anything on the host is stopped.
	if _, _, err := artifactBody(filepath.Join(t.TempDir(), "nope.tar.gz"), nil); err == nil {
		t.Fatal("expected an error for a missing artifact")
	}
}

// TestAChunkedUploadDeploys is the assumption the SSH adapter rests on.
//
// A body whose length is unknown — which is what piping stdin into an HTTP
// request produces — is sent with `Transfer-Encoding: chunked`. Nothing else in
// this suite exercises that, and the failure mode if it did not work is a
// deploy that uploads zero bytes and reports a corrupt artifact.
func TestAChunkedUploadDeploys(t *testing.T) {
	f := newDeployFixture(t)
	artifact, err := os.Open(deployableArtifact(t))
	if err != nil {
		t.Fatal(err)
	}
	defer artifact.Close()

	srv := httptest.NewServer(http.HandlerFunc(f.server.handleDeploy))
	defer srv.Close()

	// An *os.File whose length net/http cannot determine up front — not
	// because of the io.Reader(artifact) conversion below, which is a no-op:
	// http.NewRequest's type switch inspects the argument's dynamic type, and
	// *os.File was never one of the three concrete types it special-cases
	// (*bytes.Buffer, *bytes.Reader, *strings.Reader), conversion or not.
	// ContentLength stays at its zero value for any type outside that list —
	// see the field's own doc comment: "For client requests, a value of 0
	// with a non-nil Body is also treated as unknown." That is what forces
	// Transfer-Encoding: chunked on the wire; it is 0 here, not -1.
	req, err := http.NewRequest(http.MethodPost,
		srv.URL+"/apps?name=demo&env=production", io.Reader(artifact))
	if err != nil {
		t.Fatal(err)
	}
	if req.ContentLength != 0 {
		t.Fatalf("ContentLength = %d, want 0 (net/http's unknown-length sentinel for a client request, which forces chunked transfer)", req.ContentLength)
	}

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, body = %s", res.StatusCode, raw)
	}

	// The app is registered and serving, which is the only proof the bytes
	// arrived whole — a truncated gzip is refused inside deployArtifact.
	if _, ok := f.server.store.Get("demo/production"); !ok {
		t.Fatal("demo/production should be registered after a chunked upload")
	}
}
