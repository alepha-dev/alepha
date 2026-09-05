package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/alepha/bay/internal/connector"
	"github.com/alepha/bay/internal/state"
)

// ackRecorder is the connection's seat: what the executor said back.
type ackRecorder struct {
	mu   sync.Mutex
	acks []connector.Ack
}

func (r *ackRecorder) send(ack connector.Ack) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.acks = append(r.acks, ack)
	return nil
}

func (r *ackRecorder) statuses() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, 0, len(r.acks))
	for _, a := range r.acks {
		out = append(out, a.Status)
	}
	return out
}

func (r *ackRecorder) last() connector.Ack {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.acks[len(r.acks)-1]
}

func restartCommand(id string) connector.Command {
	return connector.Command{ID: id, Kind: "restart", App: "demo", Environment: "production"}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestRestartStopsAndStartsTheRunningApp(t *testing.T) {
	f := deployedApp(t)
	acts := newActions(f.server)
	rec := &ackRecorder{}
	before := f.runner.starts

	acts.Command(context.Background(), restartCommand("c1"), rec.send)

	if got := rec.statuses(); !equalStrings(got, []string{"running", "done"}) {
		t.Fatalf("acks = %v, want running then done", got)
	}
	if f.runner.starts != before+1 {
		t.Fatalf("restart must start the app once more, starts went %d -> %d", before, f.runner.starts)
	}
	if !f.runner.Running("demo/production") {
		t.Fatal("the app must be running after a restart")
	}
}

func TestUnknownActionIsRefusedAndReportedNeverRun(t *testing.T) {
	/*
		The boundary. A name outside the enum is acked failed with the
		vocabulary in the reason, and nothing on the host moves: no running
		ack, no stop, no start.
	*/
	f := deployedApp(t)
	acts := newActions(f.server)
	rec := &ackRecorder{}
	before := f.runner.starts

	acts.Command(context.Background(), connector.Command{
		ID: "c2", Kind: "exec", App: "demo", Environment: "production",
	}, rec.send)

	if got := rec.statuses(); !equalStrings(got, []string{"failed"}) {
		t.Fatalf("acks = %v, want a single failed", got)
	}
	reason := rec.last().Reason
	for _, want := range []string{"unknown action", `"exec"`, "restart", "deploy"} {
		if !strings.Contains(reason, want) {
			t.Errorf("reason %q does not name %q", reason, want)
		}
	}
	if f.runner.starts != before {
		t.Fatal("a refused action must not touch the app")
	}
}

func TestRestartRefusesWhatItCannotRestart(t *testing.T) {
	f := deployedApp(t)
	if err := f.server.store.Upsert(state.App{Name: "site", Env: "production", Static: true}); err != nil {
		t.Fatal(err)
	}
	acts := newActions(f.server)

	cases := []struct {
		name string
		cmd  connector.Command
		want string
	}{
		{"unknown instance", connector.Command{ID: "u1", Kind: "restart", App: "ghost", Environment: "production"}, "unknown instance"},
		{"static site", connector.Command{ID: "u2", Kind: "restart", App: "site", Environment: "production"}, "static site"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &ackRecorder{}
			before := f.runner.starts
			acts.Command(context.Background(), tc.cmd, rec.send)
			if got := rec.statuses(); !equalStrings(got, []string{"running", "failed"}) {
				t.Fatalf("acks = %v, want running then failed", got)
			}
			if !strings.Contains(rec.last().Reason, tc.want) {
				t.Fatalf("reason %q does not say %q", rec.last().Reason, tc.want)
			}
			if f.runner.starts != before {
				t.Fatal("a refused restart must start nothing")
			}
		})
	}
}

func TestRestartDoesNotStartAnAppSomebodyStopped(t *testing.T) {
	f := deployedApp(t)
	if err := f.runner.Stop("demo/production", 0); err != nil {
		t.Fatal(err)
	}
	acts := newActions(f.server)
	rec := &ackRecorder{}
	before := f.runner.starts

	acts.Command(context.Background(), restartCommand("c3"), rec.send)

	if rec.last().Status != "failed" || !strings.Contains(rec.last().Reason, "not running") {
		t.Fatalf("a stopped app must be a reported failure, got %+v", rec.last())
	}
	if f.runner.starts != before || f.runner.Running("demo/production") {
		t.Fatal("whoever stopped the app owns that; a restart must not reverse it")
	}
}

func TestRedeliveredIdIsReackedFromTheStoredOutcomeNotRerun(t *testing.T) {
	f := deployedApp(t)
	acts := newActions(f.server)
	rec := &ackRecorder{}
	acts.Command(context.Background(), restartCommand("c4"), rec.send)
	after := f.runner.starts

	// Lore lost the ack and asks again.
	acts.Command(context.Background(), restartCommand("c4"), rec.send)
	if got := rec.statuses(); !equalStrings(got, []string{"running", "done", "done"}) {
		t.Fatalf("acks = %v, want the stored done re-sent with no second running", got)
	}
	if f.runner.starts != after {
		t.Fatal("a redelivered terminal id must not run again")
	}

	// A new `bay serve` on the same root still remembers.
	again := newActions(f.server)
	rec2 := &ackRecorder{}
	again.Command(context.Background(), restartCommand("c4"), rec2.send)
	if got := rec2.statuses(); !equalStrings(got, []string{"done"}) {
		t.Fatalf("after a reload acks = %v, want the stored done", got)
	}
	if f.runner.starts != after {
		t.Fatal("outcomes must survive a restart of bay serve")
	}
}

func TestWelcomeIsKeptForTheActionsThatReadIt(t *testing.T) {
	f := newDeployFixture(t)
	acts := newActions(f.server)
	acts.Welcome(connector.Welcome{Slug: "ovh-1", DeployAllowed: true, StatsIntervalSeconds: 300})
	if w := acts.latestWelcome(); !w.DeployAllowed || w.Slug != "ovh-1" {
		t.Fatalf("latestWelcome = %+v", w)
	}
}

// deploySink is the sink's side of a deploy: the two pull routes for any
// command id, a digest header beside the bytes, a JSON secret set.
type deploySink struct {
	srv       *httptest.Server
	bytes     []byte
	header    string
	secrets   string
	artifacts atomic.Int32
}

func newDeploySink(t *testing.T, artifactPath string) *deploySink {
	t.Helper()
	raw, err := os.ReadFile(artifactPath)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	s := &deploySink{bytes: raw, header: hex.EncodeToString(sum[:]), secrets: "{}"}
	s.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+testSecret {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/artifact"):
			s.artifacts.Add(1)
			w.Header().Set(connector.ArtifactDigestHeader, s.header)
			_, _ = w.Write(s.bytes)
		case strings.HasSuffix(r.URL.Path, "/secrets"):
			_, _ = w.Write([]byte(s.secrets))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(s.srv.Close)
	return s
}

func (s *deploySink) digest() string { return s.header }

// deployReady is a fresh Bay enrolled against the sink and welcomed with
// deploys allowed.
func deployReady(t *testing.T, sink *deploySink, allowed bool) (*deployFixture, *actions) {
	t.Helper()
	f := newDeployFixture(t)
	if err := connector.NewStore(f.root).Set(connector.Config{Sink: sink.srv.URL, Secret: testSecret}); err != nil {
		t.Fatal(err)
	}
	acts := newActions(f.server)
	acts.Welcome(connector.Welcome{Slug: "ovh-1", DeployAllowed: allowed})
	return f, acts
}

func deployCommand(id string, sink *deploySink) connector.Command {
	return connector.Command{
		ID: id, Kind: "deploy", App: "demo", Environment: "production",
		Artifact: &connector.Artifact{ID: "art-1", SHA256: sink.digest(), Size: int64(len(sink.bytes))},
	}
}

func (r *ackRecorder) steps() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]string, 0, len(r.acks))
	for _, a := range r.acks {
		out = append(out, a.Status+":"+a.Step)
	}
	return out
}

func TestDeployPullsVerifiesAndDeploys(t *testing.T) {
	sink := newDeploySink(t, deployableArtifact(t))
	f, acts := deployReady(t, sink, true)
	rec := &ackRecorder{}

	acts.Command(context.Background(), deployCommand("d1", sink), rec.send)

	want := []string{"running:", "running:downloading", "running:verifying", "running:deploying", "done:"}
	if got := rec.steps(); !equalStrings(got, want) {
		t.Fatalf("acks = %v, want %v", got, want)
	}
	if !f.runner.Running("demo/production") || f.runner.starts != 1 {
		t.Fatalf("the deploy path must have started the app once, starts=%d", f.runner.starts)
	}
	cached := filepath.Join(f.root, "artifacts", sink.digest()+".tar.gz")
	if !connector.ArtifactCached(cached, sink.digest()) {
		t.Fatal("the verified artifact must be held under its digest for the next deploy")
	}
}

func TestDeployIsRefusedBeforeAnyFetchWhenTheWelcomeSaidNo(t *testing.T) {
	sink := newDeploySink(t, deployableArtifact(t))
	f, acts := deployReady(t, sink, false)
	rec := &ackRecorder{}

	acts.Command(context.Background(), deployCommand("d2", sink), rec.send)

	if rec.last().Status != "failed" || !strings.Contains(rec.last().Reason, "does not accept deploys") {
		t.Fatalf("a stats-only estate must refuse, got %+v", rec.last())
	}
	if sink.artifacts.Load() != 0 {
		t.Fatal("the refusal must come before any fetch")
	}
	if f.runner.starts != 0 {
		t.Fatal("nothing may be deployed")
	}
}

func TestDeployRefusesADigestMismatchAndLeavesNothing(t *testing.T) {
	sink := newDeploySink(t, deployableArtifact(t))
	// The sink states the digest the command wants and sends other bytes.
	sink.bytes = []byte("not the artifact the command named")
	f, acts := deployReady(t, sink, true)
	rec := &ackRecorder{}

	acts.Command(context.Background(), deployCommand("d3", sink), rec.send)

	last := rec.last()
	if last.Status != "failed" || last.Step != "verifying" || !strings.Contains(last.Reason, "digest mismatch") {
		t.Fatalf("a mismatch must fail at verifying, got %+v", last)
	}
	entries, _ := os.ReadDir(filepath.Join(f.root, "artifacts"))
	if len(entries) != 0 {
		t.Fatalf("a rejected artifact must leave nothing on disk: %v", entries)
	}
	if f.runner.starts != 0 {
		t.Fatal("no partial deploy may happen")
	}
}

func TestDeploySkipsTheDownloadWhenTheArtifactIsHeld(t *testing.T) {
	sink := newDeploySink(t, deployableArtifact(t))
	f, acts := deployReady(t, sink, true)

	acts.Command(context.Background(), deployCommand("d4", sink), (&ackRecorder{}).send)
	rec := &ackRecorder{}
	acts.Command(context.Background(), deployCommand("d5", sink), rec.send)

	if sink.artifacts.Load() != 1 {
		t.Fatalf("the second deploy of the same digest must not download again, got %d fetches", sink.artifacts.Load())
	}
	if got := rec.steps(); !equalStrings(got, []string{"running:", "running:deploying", "done:"}) {
		t.Fatalf("a held artifact skips the download and verify steps: %v", got)
	}
	if f.runner.starts != 2 {
		t.Fatalf("both deploys must have run, starts=%d", f.runner.starts)
	}
}

func TestDeployWritesTheSecretSetIntoTheInstanceEnvAndNowhereElse(t *testing.T) {
	sink := newDeploySink(t, deployableArtifact(t))
	sink.secrets = `{"STRIPE_KEY":"sk_live_from_lore","OTHER":"o"}`
	f, acts := deployReady(t, sink, true)
	rec := &ackRecorder{}

	acts.Command(context.Background(), deployCommand("d6", sink), rec.send)

	if rec.last().Status != "done" {
		t.Fatalf("deploy failed: %+v", rec.last())
	}
	if got := f.runner.lastSpec.Env["STRIPE_KEY"]; got != "sk_live_from_lore" {
		t.Fatalf("the secret never reached the process: %q", got)
	}
	entries, _ := os.ReadDir(f.root)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".deploy-secrets-") {
			t.Fatalf("the staged secrets file must be consumed: %s", e.Name())
		}
	}
	for _, ack := range rec.acks {
		if strings.Contains(ack.Reason, "sk_live") || strings.Contains(ack.Step, "sk_live") {
			t.Fatal("a secret value reached an ack")
		}
	}
}

func TestDeployReportsWhatTheDeployPathRefused(t *testing.T) {
	sink := newDeploySink(t, refusedArtifact(t))
	f, acts := deployReady(t, sink, true)
	rec := &ackRecorder{}

	acts.Command(context.Background(), deployCommand("d7", sink), rec.send)

	last := rec.last()
	if last.Status != "failed" || last.Step != "deploying" || last.Reason == "" {
		t.Fatalf("the deploy path's refusal must be reported at the deploying step, got %+v", last)
	}
	if f.runner.Running("demo/production") {
		t.Fatal("a refused artifact must not be running")
	}
}

func TestDeployWithoutAnArtifactIsRefused(t *testing.T) {
	sink := newDeploySink(t, deployableArtifact(t))
	_, acts := deployReady(t, sink, true)
	rec := &ackRecorder{}
	acts.Command(context.Background(), connector.Command{ID: "d8", Kind: "deploy", App: "demo", Environment: "production"}, rec.send)
	if rec.last().Status != "failed" || !strings.Contains(rec.last().Reason, "names no artifact") {
		t.Fatalf("got %+v", rec.last())
	}
}
