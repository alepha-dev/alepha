package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/deploy"
	"github.com/alepha-dev/bay/internal/naming"
)

func runningKey(t *testing.T, f *deployFixture) string {
	t.Helper()
	k, err := deploy.ReadAppSecret(filepath.Join(f.root, "apps", naming.Instance("demo", "production")))
	if err != nil {
		t.Fatal(err)
	}
	return k
}

// A rebuilt host, or a copy moved from another estate: the instance has no
// key, Lore holds one, and the instance starts on it.
func TestAnInstanceWithoutAKeyTakesTheOneLoreHolds(t *testing.T) {
	sink := newDeploySink(t, deployableArtifact(t))
	sink.appSecret = "the-key-this-copy-always-ran-on"
	f, acts := deployReady(t, sink, true)
	rec := &ackRecorder{}

	acts.Command(context.Background(), deployCommand("d1", sink), rec.send)

	if last := rec.acks[len(rec.acks)-1]; last.Status != "done" {
		t.Fatalf("deploy: %+v", last)
	}
	if got := runningKey(t, f); got != sink.appSecret {
		t.Fatalf("the instance runs on %q, not Lore's key", got)
	}
	if len(sink.appSecretAsks) != 1 || sink.appSecretAsks[0] != "value=1" {
		t.Fatalf("an instance with no key asks for the value: %v", sink.appSecretAsks)
	}
	for _, a := range rec.acks {
		if strings.Contains(a.Reason+a.Step+a.URL, sink.appSecret) {
			t.Fatalf("the key is in an ack: %+v", a)
		}
	}
}

// Rule 1: a deploy never changes the key of an instance that had one, not
// for Lore's row either, and it asks for the hash only.
func TestAnInstanceWithAKeyNeverTakesLoresKey(t *testing.T) {
	sink := newDeploySink(t, deployableArtifact(t))
	f, acts := deployReady(t, sink, true)
	acts.Command(context.Background(), deployCommand("d1", sink), (&ackRecorder{}).send)
	minted := runningKey(t, f)
	if minted == "" {
		t.Fatal("the first deploy has to leave a key")
	}

	sink.appSecret = "a-different-key-lore-holds"
	sink.appSecretAsks = nil
	rec := &ackRecorder{}
	acts.Command(context.Background(), deployCommand("d2", sink), rec.send)

	if last := rec.acks[len(rec.acks)-1]; last.Status != "done" {
		t.Fatalf("deploy: %+v", last)
	}
	if got := runningKey(t, f); got != minted {
		t.Fatal("a redeploy replaced the instance's key with Lore's")
	}
	if len(sink.appSecretAsks) != 1 || sink.appSecretAsks[0] != "" {
		t.Fatalf("an instance with a key asks for the hash only: %v", sink.appSecretAsks)
	}
}

// An older Lore has no such route: the deploy goes on and mints, as before.
func TestAnOlderLoreWithoutTheRouteStillDeploys(t *testing.T) {
	sink := newDeploySink(t, deployableArtifact(t))
	sink.appSecretStatus = 404
	f, acts := deployReady(t, sink, true)
	rec := &ackRecorder{}

	acts.Command(context.Background(), deployCommand("d1", sink), rec.send)

	if last := rec.acks[len(rec.acks)-1]; last.Status != "done" {
		t.Fatalf("deploy: %+v", last)
	}
	if runningKey(t, f) == "" {
		t.Fatal("no key minted")
	}
}

// Any other failure stops the deploy before it provisions: a key minted over
// an answer Bay could not read would then replace Lore's row.
func TestAFailedAppSecretPullFailsTheDeployBeforeItMints(t *testing.T) {
	for name, configure := range map[string]func(*deploySink){
		"a 500": func(s *deploySink) { s.appSecretStatus = 500 },
		// A hash for one key, the value of another.
		"a key unlike its hash": func(s *deploySink) {
			s.appSecretRaw = `{"sha256":"` + strings.Repeat("0", 64) + `","value":"some-key"}`
		},
		"an answer that is not JSON": func(s *deploySink) { s.appSecretRaw = "<html>" },
	} {
		t.Run(name, func(t *testing.T) {
			sink := newDeploySink(t, deployableArtifact(t))
			configure(sink)
			f, acts := deployReady(t, sink, true)
			rec := &ackRecorder{}

			acts.Command(context.Background(), deployCommand("d1", sink), rec.send)

			last := rec.acks[len(rec.acks)-1]
			if last.Status != "failed" || !strings.Contains(last.Reason, "APP_SECRET") {
				t.Fatalf("terminal ack = %+v", last)
			}
			if _, err := os.Stat(filepath.Join(f.root, "apps", naming.Instance("demo", "production"), ".env")); !os.IsNotExist(err) {
				t.Fatalf("the deploy provisioned before failing: %v", err)
			}
		})
	}
}
