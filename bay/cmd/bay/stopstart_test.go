package main

import (
	"context"
	"strings"
	"testing"

	"github.com/alepha/bay/internal/connector"
	"github.com/alepha/bay/internal/state"
)

func stopCommand(id string) connector.Command {
	return connector.Command{ID: id, Kind: "stop", App: "demo", Environment: "production"}
}

func startCommand(id string) connector.Command {
	return connector.Command{ID: id, Kind: "start", App: "demo", Environment: "production"}
}

/*
A stop is two halves, and both are asserted.

The persisted intent is what the boot loop reads, so it survives a Bay upgrade
on any runner. The park is `systemctl disable --now`, which is what survives a
host reboot on systemd, where an enabled unit comes back whatever Bay thinks.
*/
func TestStopPersistsTheIntentAndParksTheUnit(t *testing.T) {
	f := deployedApp(t)
	acts := newActions(f.server)
	rec := &ackRecorder{}

	acts.Command(context.Background(), stopCommand("c-stop"), rec.send)

	if got := rec.statuses(); !equalStrings(got, []string{"running", "done"}) {
		t.Fatalf("acks = %v, want running then done", got)
	}
	app, ok := f.server.store.Get("demo/production")
	if !ok || !app.Stopped {
		t.Fatalf("the intent must be persisted: %+v", app)
	}
	if len(f.runner.parked) != 1 || f.runner.parked[0] != "demo/production" {
		t.Fatalf("the unit must be parked, not merely stopped: %v", f.runner.parked)
	}
	if f.runner.Running("demo/production") {
		t.Fatal("the app must actually be down")
	}
}

// Reaching the state the caller asked for is not a failure. `disable --now`
// exits 0 on an inactive unit and the child runner returns nil with nothing
// running, so the effect is idempotent and the ack has to say so.
func TestStoppingAnAlreadyStoppedInstanceSucceeds(t *testing.T) {
	f := deployedApp(t)
	acts := newActions(f.server)

	acts.Command(context.Background(), stopCommand("c-stop-1"), (&ackRecorder{}).send)
	rec := &ackRecorder{}
	acts.Command(context.Background(), stopCommand("c-stop-2"), rec.send)

	if got := rec.statuses(); got[len(got)-1] != "done" {
		t.Fatalf("acks = %v, want a terminal done", got)
	}
	app, _ := f.server.store.Get("demo/production")
	if !app.Stopped {
		t.Fatal("the instance must still be stopped")
	}
}

func TestStartClearsTheIntentAndBringsTheAppBack(t *testing.T) {
	f := deployedApp(t)
	acts := newActions(f.server)
	acts.Command(context.Background(), stopCommand("c-stop"), (&ackRecorder{}).send)

	before := f.runner.starts
	rec := &ackRecorder{}
	acts.Command(context.Background(), startCommand("c-start"), rec.send)

	if got := rec.statuses(); !equalStrings(got, []string{"running", "done"}) {
		t.Fatalf("acks = %v, want running then done", got)
	}
	app, _ := f.server.store.Get("demo/production")
	if app.Stopped {
		t.Fatal("start must clear the intent, or the next boot takes it down again")
	}
	if f.runner.starts != before+1 {
		t.Fatalf("start must actually start it, starts went %d -> %d", before, f.runner.starts)
	}
	if !f.runner.Running("demo/production") {
		t.Fatal("the app must be running again")
	}
}

/*
`Systemd.Start` runs `systemctl restart`, so starting a healthy app would
bounce production in disguise. A start on something already running answers
done and touches nothing.
*/
func TestStartOnARunningInstanceIsANoOpSuccess(t *testing.T) {
	f := deployedApp(t)
	acts := newActions(f.server)
	before := f.runner.starts

	rec := &ackRecorder{}
	acts.Command(context.Background(), startCommand("c-start"), rec.send)

	if got := rec.statuses(); got[len(got)-1] != "done" {
		t.Fatalf("acks = %v, want a terminal done", got)
	}
	if f.runner.starts != before {
		t.Fatalf("a running app must not be restarted in disguise: starts went %d -> %d",
			before, f.runner.starts)
	}
}

// A static site has no process, and saying so is more useful than pretending
// the verb applied.
func TestStopAndStartRefuseAStaticSite(t *testing.T) {
	f := deployedApp(t)
	if err := f.server.store.Upsert(state.App{
		Name: "site", Env: "production", Static: true, Release: "r1",
	}); err != nil {
		t.Fatal(err)
	}
	acts := newActions(f.server)

	for _, kind := range []string{"stop", "start"} {
		rec := &ackRecorder{}
		acts.Command(context.Background(), connector.Command{
			ID: "c-static-" + kind, Kind: kind, App: "site", Environment: "production",
		}, rec.send)
		last := rec.acks[len(rec.acks)-1]
		if last.Status != "failed" {
			t.Fatalf("%s on a static site must fail: %+v", kind, last)
		}
		if last.Reason == "" {
			t.Fatalf("%s must say why it refused", kind)
		}
	}
}

// A restart is not the way back from a stop, and its refusal now says what is.
func TestRestartStillRefusesAStoppedAppAndNamesStart(t *testing.T) {
	f := deployedApp(t)
	acts := newActions(f.server)
	acts.Command(context.Background(), stopCommand("c-stop"), (&ackRecorder{}).send)

	rec := &ackRecorder{}
	acts.Command(context.Background(), restartCommand("c-restart"), rec.send)

	last := rec.acks[len(rec.acks)-1]
	if last.Status != "failed" {
		t.Fatalf("a restart must refuse a stopped app: %+v", last)
	}
	if !strings.Contains(last.Reason, "start it instead") {
		t.Fatalf("the refusal must name the way back: %q", last.Reason)
	}
}

// An unknown verb is still refused, and the reason names the whole vocabulary
// so the other side learns what this Bay speaks.
func TestTheRefusalNamesEveryVerb(t *testing.T) {
	f := deployedApp(t)
	acts := newActions(f.server)
	rec := &ackRecorder{}

	acts.Command(context.Background(), connector.Command{
		ID: "c-unknown", Kind: "rm -rf", App: "demo", Environment: "production",
	}, rec.send)

	reason := rec.acks[len(rec.acks)-1].Reason
	for _, verb := range []string{"restart", "deploy", "stop", "start"} {
		if !strings.Contains(reason, verb) {
			t.Fatalf("the refusal must name %q: %q", verb, reason)
		}
	}
}

/*
The boot loop honours the intent, which is what makes a stop survive a Bay
restart on any runner.

`restoreApps` is exactly what `cmdServe` runs on the way up, so calling it here
is the same code path a Bay upgrade takes.
*/
func TestTheBootLoopSkipsAStoppedApp(t *testing.T) {
	f := deployedApp(t)
	acts := newActions(f.server)
	acts.Command(context.Background(), stopCommand("c-stop"), (&ackRecorder{}).send)

	before := f.runner.starts
	f.server.restoreApps()

	if f.runner.starts != before {
		t.Fatalf("a bay restart must leave a stopped app stopped: starts went %d -> %d",
			before, f.runner.starts)
	}
	if f.runner.Running("demo/production") {
		t.Fatal("the app must still be down after the boot loop ran")
	}

	// And once it is started again, the next boot brings it back.
	acts.Command(context.Background(), startCommand("c-start"), (&ackRecorder{}).send)
	f.runner.Stop("demo/production", 0)
	before = f.runner.starts
	f.server.restoreApps()
	if f.runner.starts != before+1 {
		t.Fatalf("an app nobody stopped must come back: starts went %d -> %d",
			before, f.runner.starts)
	}
}

/*
A deploy is an instruction to run this release, and it already starts the app
unconditionally. So the flag must not be carried forward, unlike every other
runtime-owned field on the record.
*/
func TestUpsertDoesNotCarryTheStoppedFlagForward(t *testing.T) {
	f := deployedApp(t)
	if err := f.server.store.SetStopped("demo/production", true); err != nil {
		t.Fatal(err)
	}
	existing, _ := f.server.store.Get("demo/production")

	if err := f.server.store.Upsert(state.App{
		Name: "demo", Env: "production", Release: "r2",
		Domains: existing.Domains, Port: existing.Port,
	}); err != nil {
		t.Fatal(err)
	}

	app, _ := f.server.store.Get("demo/production")
	if app.Stopped {
		t.Fatal("a deploy must clear the intent: it starts the app unconditionally")
	}
}
