package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/s3/s3test"
	"github.com/alepha-dev/bay/internal/state"
)

// rebuilt backs an app with data up, purges it, and answers the bucket and the
// key it ran on: the 2026-11-10 shape, on one machine.
func rebuilt(t *testing.T) (*deployFixture, *s3test.Server, string, string) {
	t.Helper()
	node := hostNodeWithSQLite(t)
	f, srv := recoveryHost(t, node)
	artifact := artifactWithDatabase(t)
	first, failure := f.deploy(artifact)
	if failure != nil {
		t.Fatalf("first deploy: %v", failure)
	}
	if first.AppSecret != state.SecretMinted {
		t.Fatalf("a first deploy mints, said %q", first.AppSecret)
	}
	key := runningKey(t, f)
	sqlite(t, node, f.databasePath(), `db.exec("CREATE TABLE totp (secret TEXT)")`)
	if rec := f.backup(t); rec.Code != http.StatusOK {
		t.Fatalf("backup: %d %s", rec.Code, rec.Body)
	}
	if rec := removeRequest(t, f.server, "?purge=yes"); rec.Code != http.StatusOK {
		t.Fatalf("remove: %d %s", rec.Code, rec.Body)
	}
	time.Sleep(time.Until(time.Now().Truncate(time.Second).Add(time.Second + 50*time.Millisecond)))
	return f, srv, key, artifact
}

func TestARebuiltHostComesBackOnTheSnapshotsKeyAndSaysSo(t *testing.T) {
	f, _, key, artifact := rebuilt(t)

	again, failure := f.deploy(artifact)
	if failure != nil {
		t.Fatalf("redeploy: %v", failure)
	}

	if again.AppSecret != state.SecretSnapshot || runningKey(t, f) != key {
		t.Fatalf("the rebuilt instance must run on the snapshot's key, source %q", again.AppSecret)
	}
	if st := f.app(t).AppSecret; st == nil || st.Source != state.SecretSnapshot || st.Warning != "" {
		t.Fatalf("recorded %+v", st)
	}
	if warning, _ := again.Restore["warning"].(string); warning != "" {
		t.Fatalf("a recovery that brought the key back warns of nothing: %q", warning)
	}
}

// The DR test of 2026-11-10: data back, key new, and nothing said. Now it is
// a warning in the deploy's answer and a problem in `bay status` until the
// next deploy.
func TestAKeyMintedOverRestoredDataIsAWarningUntilTheNextDeploy(t *testing.T) {
	f, srv, _, artifact := rebuilt(t)
	for _, k := range srv.Keys() {
		if strings.HasSuffix(k, "/app-secret") {
			if err := srv.Client(t).Delete(t.Context(), k); err != nil {
				t.Fatal(err)
			}
		}
	}

	again, failure := f.deploy(artifact)
	if failure != nil {
		t.Fatalf("redeploy: %v", failure)
	}

	if again.AppSecret != state.SecretMinted {
		t.Fatalf("source %q", again.AppSecret)
	}
	warning, _ := again.Restore["warning"].(string)
	if !strings.Contains(warning, "NEW APP_SECRET") || !strings.Contains(warning, "bay secret replace") {
		t.Fatalf("the deploy must warn loudly, said %v", again.Restore)
	}
	line := computeStatus(listedApp{App: f.app(t), Running: true}, time.Now(), 24*time.Hour)
	if !strings.Contains(strings.Join(line.Problems, "\n"), "NEW APP_SECRET") || line.AppSecret != state.SecretMinted {
		t.Fatalf("bay status must flag it: %+v", line)
	}

	next, failure := f.deploy(artifact)
	if failure != nil {
		t.Fatalf("next deploy: %v", failure)
	}
	if next.AppSecret != state.SecretKept || f.app(t).AppSecret.Warning != "" {
		t.Fatalf("the next deploy writes kept and clears the warning: %+v", f.app(t).AppSecret)
	}
}

// A deploy queued by Lore says where the key came from, and its warning, on
// the terminal ack: before this, Lore never heard even the empty-database one.
func TestTheDeployAckCarriesTheKeySourceAndTheWarning(t *testing.T) {
	sink := newDeploySink(t, deployableArtifact(t))
	f, acts := deployReady(t, sink, true)
	rec := &ackRecorder{}

	acts.Command(context.Background(), deployCommand("d1", sink), rec.send)

	last := rec.acks[len(rec.acks)-1]
	if last.Status != "done" || last.AppSecretSource != state.SecretMinted {
		t.Fatalf("terminal ack %+v", last)
	}
	if st := f.app(t).AppSecret; st == nil || st.Lore != state.LoreSecretSent {
		t.Fatalf("a first deploy sends Lore its key and records it: %+v", st)
	}

	acts.Command(context.Background(), deployCommand("d2", sink), (&ackRecorder{}).send)
	if st := f.app(t).AppSecret; st.Lore != state.LoreSecretMatch || st.Source != state.SecretKept {
		t.Fatalf("the next one finds Lore's equal: %+v", st)
	}

	again := &ackRecorder{}
	acts.Command(context.Background(), deployCommand("d1", sink), again.send)
	if len(again.acks) != 1 || again.acks[0].AppSecretSource != state.SecretMinted {
		t.Fatalf("a re-ack says the source again: %+v", again.acks)
	}
	if strings.Contains(last.Warning+last.Reason, runningKey(t, f)) {
		t.Fatal("the key is in an ack")
	}
}

func TestBayDoctorComparesTheKeyWithTheLatestSnapshot(t *testing.T) {
	f := newKeyFixture(t)
	f.backedUp(t)
	var st state.State
	raw, err := os.ReadFile(filepath.Join(f.root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &st); err != nil {
		t.Fatal(err)
	}

	checks := appSecretChecks(t.Context(), f.root, &st)
	if len(checks) != 1 || !checks[0].OK || !strings.Contains(checks[0].Detail, "same key") {
		t.Fatalf("checks %+v", checks)
	}

	f.setKey(t, "rotated-since-the-backup")
	checks = appSecretChecks(t.Context(), f.root, &st)
	if checks[0].OK || !checks[0].Warn || !strings.Contains(checks[0].Detail, "ANOTHER key") {
		t.Fatalf("a key other than the snapshot's is a warning: %+v", checks)
	}
	if strings.Contains(checks[0].Detail, "rotated-since") {
		t.Fatal("doctor names the key")
	}
}

func TestARestoreTestSaysWhetherTheBundleCarriesAKey(t *testing.T) {
	f := newKeyFixture(t)
	f.backedUp(t)

	report, err := f.server.verifyInstance(t.Context(), f.app(t), nil)
	if err != nil {
		t.Fatal(err)
	}
	if report.AppSecret != "carried" {
		t.Fatalf("report %+v", report)
	}
	if got := verifyResult("demo/production", report, nil)["appSecret"]; got != "carried" {
		t.Fatalf("the result Lore stores says it too: %v", got)
	}
}
