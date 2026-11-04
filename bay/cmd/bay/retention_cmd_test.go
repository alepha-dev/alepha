package main

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/backuppolicy"
)

func TestTaggedBackupsAndTheRetentionPlan(t *testing.T) {
	f, _, _ := bundleFixture(t)

	rec := f.call(t, http.MethodPost, "/apps/demo/production/backup?tag=before-v2", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "-before-v2/manifest.json") {
		t.Fatalf("tagged backup: %d %s", rec.Code, rec.Body)
	}
	if rec := f.call(t, http.MethodPost, "/apps/demo/production/backup?tag=Before%20V2", ""); rec.Code != http.StatusPreconditionFailed {
		t.Fatalf("bad tag: %d %s", rec.Code, rec.Body)
	}
	time.Sleep(1100 * time.Millisecond) // stamps are to the second
	if rec := f.call(t, http.MethodPost, "/apps/demo/production/backup", ""); rec.Code != http.StatusOK {
		t.Fatalf("backup: %d %s", rec.Code, rec.Body)
	}

	rec = f.call(t, http.MethodGet, "/apps/demo/production/backups?plan=1", "")
	body := decode(t, rec)
	if rec.Code != http.StatusOK || body["prunes"] != true || body["keep"] != float64(2) || body["delete"] != float64(0) {
		t.Fatalf("plan: %d %v", rec.Code, body)
	}
	backups := body["backups"].([]any)
	tagged := backups[1].(map[string]any)
	if tagged["tag"] != "before-v2" || !strings.Contains(strings.Join(toStrings(tagged["reasons"]), ","), "tagged before-v2") {
		t.Fatalf("tagged entry %v", tagged)
	}
	if !strings.Contains(body["policy"].(string), "keep 7") {
		t.Fatalf("policy line %v", body["policy"])
	}
}

func toStrings(v any) []string {
	var out []string
	for _, s := range v.([]any) {
		out = append(out, s.(string))
	}
	return out
}

func TestPreDeployBackupNeverBlocksADeploy(t *testing.T) {
	f, srv, _ := bundleFixture(t)
	redeploy := func() *deployOutcome {
		t.Helper()
		out, failure := f.server.deployArtifact(context.Background(), deployArtifactOptions{
			Artifact: deployableArtifact(t), Name: "demo", Env: "production",
			BackupPolicy: &backuppolicy.Policy{OnDeploy: backuppolicy.Bool(true)},
		})
		if failure != nil {
			t.Fatal(failure)
		}
		// The test artifact declares no database; the fixture marks the row.
		app := f.app(t)
		app.Backups = true
		if err := f.server.store.Upsert(app); err != nil {
			t.Fatal(err)
		}
		return out
	}

	out := redeploy()
	if key, _ := out.PreDeployBackup["key"].(string); !strings.Contains(key, "-pre-deploy/manifest.json") {
		t.Fatalf("pre-deploy backup: %v", out.PreDeployBackup)
	}

	srv.Fail = func(*http.Request) int { return http.StatusServiceUnavailable }
	out = redeploy()
	if _, failed := out.PreDeployBackup["error"]; !failed || f.app(t).LastBackupError == "" {
		t.Fatalf("the bucket is down: the deploy goes on and says so, got %v", out.PreDeployBackup)
	}
}

func TestTheSchedulerBacksOffAfterAFailure(t *testing.T) {
	f, srv, _ := bundleFixture(t)
	f.server.backupInterval = time.Hour
	srv.Fail = func(*http.Request) int { return http.StatusServiceUnavailable }

	f.server.runDueBackups(context.Background())
	retry, ok := f.server.backupRetries["demo/production"]
	if !ok || retry.failures != 1 || time.Until(retry.at) < 50*time.Second {
		t.Fatalf("after a failure: %+v", retry)
	}
	f.server.runDueBackups(context.Background())
	if f.server.backupRetries["demo/production"].failures != 1 {
		t.Fatal("retried before the backoff was over")
	}

	srv.Fail = nil
	retry.at = time.Now().Add(-time.Second)
	f.server.backupRetries["demo/production"] = retry
	f.server.runDueBackups(context.Background())
	if _, still := f.server.backupRetries["demo/production"]; still || f.app(t).LastBackupAt == "" {
		t.Fatalf("a success clears the backoff: %+v", f.server.backupRetries)
	}
	if retryBackoff(1) != time.Minute || retryBackoff(2) != 5*time.Minute || retryBackoff(9) != 15*time.Minute {
		t.Fatal("backoff steps")
	}
}
