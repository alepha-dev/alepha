package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/connector"
	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/state"
)

/*
The connector's removal verbs (#Q3153, folio #F1455 of the Alepha project):
`remove` is `bay remove` without `--purge`, `stack-remove` is `bay stack
destroy` without it, both held to the deploy switch, and neither can delete
data, because nothing on the wire can ask for it.
*/

func removeCommand(id string) connector.Command {
	return connector.Command{ID: id, Kind: "remove", App: "demo", Environment: "production"}
}

func TestRemoveAction(t *testing.T) {
	t.Run("unregisters the instance and keeps its data", func(t *testing.T) {
		f := deployedApp(t)
		acts := newActions(f.server)
		acts.Welcome(connector.Welcome{Slug: "ovh-1", DeployAllowed: true})
		rec := &ackRecorder{}

		acts.Command(context.Background(), removeCommand("r1"), rec.send)

		last := rec.last()
		if got := rec.statuses(); !equalStrings(got, []string{"running", "done"}) {
			t.Fatalf("acks = %v (%+v), want running then done", got, last)
		}
		if _, ok := f.server.store.Get("demo/production"); ok {
			t.Fatal("the instance must be unregistered")
		}
		if len(f.runner.removes) != 1 || f.runner.removes[0].purge {
			t.Fatalf("expected one Remove without purge, got %+v", f.runner.removes)
		}
		dir := filepath.Join(f.root, "apps", naming.Instance("demo", "production"))
		if _, err := os.Stat(dir); err != nil {
			t.Fatalf("the data must be kept at %s: %v", dir, err)
		}
		if !strings.Contains(last.Reason, dir) || !strings.Contains(last.Reason, "--purge") {
			t.Fatalf("the ack must say where the data is and how to delete it: %q", last.Reason)
		}
	})

	t.Run("refused while the host does not accept deploys, and nothing moves", func(t *testing.T) {
		f := deployedApp(t)
		acts := newActions(f.server)
		acts.Welcome(connector.Welcome{Slug: "ovh-1", DeployAllowed: false})
		rec := &ackRecorder{}

		acts.Command(context.Background(), removeCommand("r2"), rec.send)

		if last := rec.last(); last.Status != "failed" || !strings.Contains(last.Reason, "does not accept deploys") {
			t.Fatalf("ack = %+v", last)
		}
		if _, ok := f.server.store.Get("demo/production"); !ok {
			t.Fatal("a refused removal must leave the instance registered")
		}
	})

	t.Run("an instance that is not here is answered done, so a redelivery cannot fail", func(t *testing.T) {
		f := deployedApp(t)
		acts := newActions(f.server)
		acts.Welcome(connector.Welcome{Slug: "ovh-1", DeployAllowed: true})
		rec := &ackRecorder{}

		acts.Command(context.Background(), connector.Command{
			ID: "r3", Kind: "remove", App: "ghost", Environment: "production",
		}, rec.send)

		if last := rec.last(); last.Status != "done" || !strings.Contains(last.Reason, "nothing to remove") {
			t.Fatalf("ack = %+v", last)
		}
		if len(f.runner.removes) != 0 {
			t.Fatal("nothing must be uninstalled for an unknown instance")
		}
	})

	t.Run("a stack member is refused: it goes with its stack environment", func(t *testing.T) {
		f := deployedApp(t)
		app, _ := f.server.store.Get("demo/production")
		app.Name, app.Stack, app.Service = "crm.api", "crm", "api"
		if err := f.server.store.Upsert(app); err != nil {
			t.Fatal(err)
		}
		acts := newActions(f.server)
		acts.Welcome(connector.Welcome{Slug: "ovh-1", DeployAllowed: true})
		rec := &ackRecorder{}

		acts.Command(context.Background(), connector.Command{
			ID: "r4", Kind: "remove", App: "crm.api", Environment: "production",
		}, rec.send)

		if last := rec.last(); last.Status != "failed" || !strings.Contains(last.Reason, "stack") {
			t.Fatalf("ack = %+v", last)
		}
		if _, ok := f.server.store.Get("crm.api/production"); !ok {
			t.Fatal("a refused removal must leave the member registered")
		}
	})
}

func TestStackRemoveAction(t *testing.T) {
	stackRemove := func(id, stackName string) connector.Command {
		return connector.Command{ID: id, Kind: "stack-remove", Stack: stackName, Environment: "production"}
	}

	t.Run("forgets the environment and keeps its variables", func(t *testing.T) {
		f := newDeployFixture(t)
		if err := f.server.store.MutateStackEnv("web", "production", func(*state.StackEnv) error { return nil }); err != nil {
			t.Fatal(err)
		}
		acts := newActions(f.server)
		acts.Welcome(connector.Welcome{Slug: "ovh-1", DeployAllowed: true})
		rec := &ackRecorder{}

		acts.Command(context.Background(), stackRemove("sr1", "web"), rec.send)

		if last := rec.last(); last.Status != "done" || !strings.Contains(last.Reason, "kept") {
			t.Fatalf("ack = %+v", last)
		}
		if _, ok := f.server.store.StackEnv("web", "production"); ok {
			t.Fatal("the stack environment must be forgotten")
		}
	})

	t.Run("refused while the host does not accept deploys", func(t *testing.T) {
		f := newDeployFixture(t)
		if err := f.server.store.MutateStackEnv("web", "production", func(*state.StackEnv) error { return nil }); err != nil {
			t.Fatal(err)
		}
		acts := newActions(f.server)
		acts.Welcome(connector.Welcome{Slug: "ovh-1", DeployAllowed: false})
		rec := &ackRecorder{}

		acts.Command(context.Background(), stackRemove("sr2", "web"), rec.send)

		if last := rec.last(); last.Status != "failed" || !strings.Contains(last.Reason, "does not accept deploys") {
			t.Fatalf("ack = %+v", last)
		}
		if _, ok := f.server.store.StackEnv("web", "production"); !ok {
			t.Fatal("a refused removal must leave the environment")
		}
	})

	t.Run("an environment that is not here is done, a malformed name is refused", func(t *testing.T) {
		f := newDeployFixture(t)
		acts := newActions(f.server)
		acts.Welcome(connector.Welcome{Slug: "ovh-1", DeployAllowed: true})

		rec := &ackRecorder{}
		acts.Command(context.Background(), stackRemove("sr3", "web"), rec.send)
		if last := rec.last(); last.Status != "done" || !strings.Contains(last.Reason, "nothing to remove") {
			t.Fatalf("ack = %+v", last)
		}

		rec = &ackRecorder{}
		acts.Command(context.Background(), stackRemove("sr4", "Web_1"), rec.send)
		if last := rec.last(); last.Status != "failed" {
			t.Fatalf("a malformed stack name was accepted: %+v", last)
		}
	})
}

// The refusal of an unknown verb names the removal verbs too, so a Lore that
// sends one to an older Bay learns which Bay it is talking to.
func TestTheRefusalNamesTheRemovalVerbs(t *testing.T) {
	f := deployedApp(t)
	acts := newActions(f.server)
	rec := &ackRecorder{}

	acts.Command(context.Background(), connector.Command{
		ID: "c-purge", Kind: "purge", App: "demo", Environment: "production",
	}, rec.send)

	reason := rec.last().Reason
	for _, verb := range []string{"remove", "stack-remove"} {
		if !strings.Contains(reason, verb) {
			t.Fatalf("the refusal must name %q: %q", verb, reason)
		}
	}
}
