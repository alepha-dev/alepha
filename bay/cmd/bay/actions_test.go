package main

import (
	"context"
	"strings"
	"sync"
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

func TestDeployIsAReportedFailureUntilItLands(t *testing.T) {
	f := deployedApp(t)
	acts := newActions(f.server)
	rec := &ackRecorder{}
	acts.Command(context.Background(), connector.Command{
		ID: "d1", Kind: "deploy", App: "demo", Environment: "production",
		Artifact: &connector.Artifact{ID: "a", SHA256: strings.Repeat("0", 64), Size: 1},
	}, rec.send)
	if got := rec.statuses(); !equalStrings(got, []string{"running", "failed"}) {
		t.Fatalf("acks = %v", got)
	}
	if !strings.Contains(rec.last().Reason, "not available") {
		t.Fatalf("reason %q", rec.last().Reason)
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
