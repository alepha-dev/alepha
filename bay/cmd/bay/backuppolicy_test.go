package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/backuppolicy"
	"github.com/alepha-dev/bay/internal/state"
)

func (f *deployFixture) call(t *testing.T, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	f.server.controlMux().ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
	return rec
}

func effectiveOf(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	e, ok := body["effective"].(map[string]any)
	if !ok {
		t.Fatalf("no effective policy in %v", body)
	}
	return e
}

func TestOperatorPolicyLayersOverGlobalAndBuiltIn(t *testing.T) {
	f := newBackupFixture(t)
	f.server.backupInterval = 24 * time.Hour

	if rec := f.call(t, http.MethodPut, "/config/backup", `{"retention":{"keep":30}}`); rec.Code != http.StatusOK {
		t.Fatalf("global: %d %s", rec.Code, rec.Body.String())
	}
	rec := f.call(t, http.MethodPut, "/apps/demo/production/backup/config", `{"schedule":{"every":"6h"}}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("operator: %d %s", rec.Code, rec.Body.String())
	}
	e := effectiveOf(t, decode(t, rec))
	src := e["source"].(map[string]any)
	if e["every"] != "6h" || src["schedule"] != "operator" || e["keep"] != float64(30) || src["keep"] != "global" ||
		e["enabled"] != true || src["enabled"] != "built-in" {
		t.Fatalf("effective = %v", e)
	}

	rec = f.call(t, http.MethodDelete, "/apps/demo/production/backup/config", "")
	if e := effectiveOf(t, decode(t, rec)); e["every"] != "1d" {
		t.Fatalf("clearing the override must fall back to the built-in interval, got %v", e)
	}
}

func TestPolicyRoutesRefuseWhatTheyWouldNotEnforce(t *testing.T) {
	f := newBackupFixture(t)
	for path, body := range map[string]string{
		"/config/backup":                      `{"schedule":{"cron":"* * * * *"}}`,
		"/apps/demo/production/backup/config": `{"schedule":{"every":"1m"}}`,
	} {
		if rec := f.call(t, http.MethodPut, path, body); rec.Code != http.StatusBadRequest {
			t.Fatalf("%s %s: want 400, got %d %s", path, body, rec.Code, rec.Body.String())
		}
	}
	if rec := f.call(t, http.MethodGet, "/apps/nope/production/backup/config", ""); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown app: %d", rec.Code)
	}
}

func TestDeployRefusesAnInvalidDeclaredPolicyBeforeStaging(t *testing.T) {
	f := newDeployFixture(t)
	artifact, err := os.Open(deployableArtifact(t))
	if err != nil {
		t.Fatal(err)
	}
	defer artifact.Close()

	rec := httptest.NewRecorder()
	q := `{"retention":{"keep":0}}`
	f.server.handleDeploy(rec, httptest.NewRequest(http.MethodPost,
		"/apps?name=demo&env=production&backupPolicy="+url.QueryEscape(q), artifact))
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "operator's choice") {
		t.Fatalf("want 400 naming the rule, got %d %s", rec.Code, rec.Body.String())
	}
	if _, ok := f.server.store.Get("demo/production"); ok {
		t.Fatal("a refused policy must not deploy anything")
	}
}

func TestRedeployReplacesTheDeclaredLayerAndKeepsTheOverride(t *testing.T) {
	f := newDeployFixture(t)
	deploy := func(p *backuppolicy.Policy) {
		t.Helper()
		if _, failure := f.server.deployArtifact(context.Background(), deployArtifactOptions{
			Artifact: deployableArtifact(t), Name: "demo", Env: "production", BackupPolicy: p,
		}); failure != nil {
			t.Fatal(failure)
		}
	}
	deploy(&backuppolicy.Policy{Schedule: &backuppolicy.Schedule{Every: "6h"}})
	if err := f.server.store.SetBackupOverride("demo/production", &backuppolicy.Policy{Retention: &backuppolicy.Retention{Keep: backuppolicy.Int(3)}}); err != nil {
		t.Fatal(err)
	}

	deploy(nil)

	app := f.app(t)
	if app.BackupDeclared != nil {
		t.Fatalf("a deploy that declares nothing must clear the previous declaration, got %+v", app.BackupDeclared)
	}
	if app.BackupOverride == nil || *app.BackupOverride.Retention.Keep != 3 {
		t.Fatalf("the operator's override must survive a redeploy, got %+v", app.BackupOverride)
	}
}

func lastBackupAfter(t *testing.T, f *deployFixture) string {
	t.Helper()
	f.server.runDueBackups(context.Background())
	return f.app(t).LastBackupAt
}

func TestTheScheduleFollowsEachAppsPolicy(t *testing.T) {
	t.Run("off by default, on for the app the operator turned on", func(t *testing.T) {
		f := newBackupFixture(t)
		pointAt(t, f, newMemoryS3(t).srv.URL)
		f.server.backupInterval = 0

		if got := lastBackupAfter(t, f); got != "" {
			t.Fatalf("built-in off: nothing should run, got %s", got)
		}
		if err := f.server.store.SetBackupOverride("demo/production", &backuppolicy.Policy{Enabled: backuppolicy.Bool(true)}); err != nil {
			t.Fatal(err)
		}
		if got := lastBackupAfter(t, f); got == "" {
			t.Fatal("the operator turned this app on: it must be backed up")
		}
	})

	t.Run("an app switched off is skipped while the host default is on", func(t *testing.T) {
		f := newBackupFixture(t)
		pointAt(t, f, newMemoryS3(t).srv.URL)
		f.server.backupInterval = time.Hour
		if err := f.server.store.SetBackupOverride("demo/production", &backuppolicy.Policy{Enabled: backuppolicy.Bool(false)}); err != nil {
			t.Fatal(err)
		}
		if got := lastBackupAfter(t, f); got != "" {
			t.Fatalf("switched off: nothing should run, got %s", got)
		}
	})

	t.Run("the app's own interval decides when it is due", func(t *testing.T) {
		f := newBackupFixture(t)
		pointAt(t, f, newMemoryS3(t).srv.URL)
		f.server.backupInterval = 24 * time.Hour
		app := f.app(t)
		app.LastBackupAt = time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339)
		app.BackupDeclared = &backuppolicy.Policy{Schedule: &backuppolicy.Schedule{Every: "1h"}}
		if err := f.server.store.Upsert(app); err != nil {
			t.Fatal(err)
		}
		before := app.LastBackupAt
		if got := lastBackupAfter(t, f); got == before {
			t.Fatal("declared every 1h, last run 2h ago: it is due")
		}
	})
}

func TestPruneUsesTheAppsKeep(t *testing.T) {
	f := newBackupFixture(t)
	bucket := newMemoryS3(t, oldBackups...)
	pointAt(t, f, bucket.srv.URL) // global keep 1, through the legacy S3 field
	if err := f.server.store.SetBackupOverride("demo/production", &backuppolicy.Policy{Retention: &backuppolicy.Retention{Keep: backuppolicy.Int(3)}}); err != nil {
		t.Fatal(err)
	}
	if rec := f.backup(t); rec.Code != http.StatusOK {
		t.Fatalf("backup: %d %s", rec.Code, rec.Body.String())
	}
	if got := bucket.deletedKeys(); len(got) != 0 {
		t.Fatalf("keep 3 with 3 backups must delete nothing, deleted %v", got)
	}
}

func TestLegacyS3KeepOnlyFillsTheGlobalKeep(t *testing.T) {
	f := newBackupFixture(t)
	pointAt(t, f, "http://127.0.0.1:1") // legacy keep 1
	global := &backuppolicy.Policy{Retention: &backuppolicy.Retention{Daily: backuppolicy.Int(7), Weekly: backuppolicy.Int(4)}}
	if err := f.server.store.SetBackupPolicy(global); err != nil {
		t.Fatal(err)
	}
	r := f.server.globalBackupLayer().Policy.Retention
	if r == nil || r.Keep == nil || *r.Keep != 1 || r.Daily == nil || *r.Daily != 7 || r.Weekly == nil || *r.Weekly != 4 {
		t.Fatalf("legacy keep must join daily 7 / weekly 4, not replace them: %+v", r)
	}
	if stored := f.server.store.BackupPolicy(); stored.Retention.Keep != nil {
		t.Fatal("the stored global policy must not be changed")
	}
}

func TestPolicyLineNamesEveryRetentionLayer(t *testing.T) {
	p := backuppolicy.Effective{Enabled: true, Every: 6 * time.Hour, Keep: 14, Daily: 10, KeepPreDeploy: 5,
		Sources: backuppolicy.Sources{Schedule: backuppolicy.Global, Keep: backuppolicy.Global, Daily: backuppolicy.Operator, Verify: backuppolicy.Global}}
	if line := policyLine(p); !strings.Contains(line, "10 daily, 5 pre-deploy (global, operator)") {
		t.Fatalf("both layers behind the retention must be named: %s", line)
	}
}

func TestStatusJudgesStalenessByTheAppsPolicy(t *testing.T) {
	now := time.Date(2026, 1, 2, 12, 0, 0, 0, time.UTC)
	app := listedApp{App: state.App{Name: "demo", Env: "production", Backups: true,
		LastBackupAt: now.Add(-3 * time.Hour).Format(time.RFC3339)}, Running: true}

	app.BackupPolicy = &backuppolicy.Effective{Enabled: true, Every: time.Hour}
	if line := computeStatus(app, now, 24*time.Hour); !line.BackupStale {
		t.Fatal("every 1h, 3h old: stale, whatever the host-wide interval")
	}

	app.BackupPolicy = &backuppolicy.Effective{Enabled: false, Every: time.Hour}
	line := computeStatus(app, now, time.Hour)
	if line.BackupStale || len(line.Problems) != 0 {
		t.Fatalf("an app switched off on purpose is not a problem: %+v", line)
	}
	if line.BackupAge != "3h0m0s" {
		t.Fatalf("the age is still worth showing, got %q", line.BackupAge)
	}

	app.BackupPolicy = nil
	if line := computeStatus(app, now, time.Hour); !line.BackupStale {
		t.Fatal("an older server sends no policy: fall back to the host interval")
	}
}

func TestPolicyFlagsEditOnlyWhatTheyName(t *testing.T) {
	p := &backuppolicy.Policy{
		Enabled:   backuppolicy.Bool(true),
		Schedule:  &backuppolicy.Schedule{Every: "6h"},
		Retention: &backuppolicy.Retention{Keep: backuppolicy.Int(7)},
	}
	if err := applyPolicyFlags(p, []string{"--keep", "30", "--every", "inherit"}); err != nil {
		t.Fatal(err)
	}
	if !*p.Enabled || p.Schedule != nil || *p.Retention.Keep != 30 {
		t.Fatalf("got %+v", p)
	}
	for _, bad := range [][]string{
		{"--on", "--off"}, {"--every", "daily"}, {"--keep", "lots"}, {"--cron", "x"},
		{"--every", "6h", "--at", "03:00"}, {"--tz", "Mars/Olympus"}, {"--window", "night"},
		{"--keep-tagged", "maybe"}, {"--prune", "s3"}, {"--on-deploy", "--no-on-deploy"}, {"--max-age", "1h"},
	} {
		if err := applyPolicyFlags(&backuppolicy.Policy{}, bad); err == nil {
			t.Fatalf("%v should be refused", bad)
		}
	}

	// A new shape replaces the old one and keeps the timezone.
	p = &backuppolicy.Policy{Schedule: &backuppolicy.Schedule{Every: "6h", Timezone: "Europe/Paris"}}
	if err := applyPolicyFlags(p, []string{"--at", "03:00,15:00", "--daily", "7", "--weekly", "4",
		"--on-deploy", "--keep-pre-deploy", "3", "--window", "01:00-06:00", "--prune", "lifecycle"}); err != nil {
		t.Fatal(err)
	}
	if p.Schedule.Every != "" || len(p.Schedule.At) != 2 || p.Schedule.Timezone != "Europe/Paris" || *p.Retention.Daily != 7 ||
		*p.Retention.Weekly != 4 || !*p.OnDeploy || *p.Retention.KeepPreDeploy != 3 || p.Window != "01:00-06:00" || p.Prune != "lifecycle" {
		t.Fatalf("got %+v %+v %+v", p, p.Schedule, p.Retention)
	}
	if err := applyPolicyFlags(p, []string{"--at", "inherit", "--tz", "inherit", "--daily", "inherit", "--window", "any"}); err != nil {
		t.Fatal(err)
	}
	if p.Schedule != nil || p.Retention.Daily != nil || p.Window != "any" {
		t.Fatalf("inherit: %+v %+v", p.Schedule, p.Retention)
	}
}

// An artifact pushed from the Lore console carries no policy: its silence is
// not a declaration, so the policy the last CLI deploy declared stays.
func TestAConsoleDeployKeepsTheDeclaredPolicy(t *testing.T) {
	f := newDeployFixture(t)
	if _, failure := f.server.deployArtifact(context.Background(), deployArtifactOptions{
		Artifact: deployableArtifact(t), Name: "demo", Env: "production",
		BackupPolicy: &backuppolicy.Policy{Schedule: &backuppolicy.Schedule{Every: "6h"}},
	}); failure != nil {
		t.Fatal(failure)
	}

	if _, failure := f.server.deployArtifact(context.Background(), deployArtifactOptions{
		Artifact: deployableArtifact(t), Name: "demo", Env: "production", KeepBackupPolicy: true,
	}); failure != nil {
		t.Fatal(failure)
	}

	app := f.app(t)
	if app.BackupDeclared == nil || app.BackupDeclared.Schedule == nil || app.BackupDeclared.Schedule.Every != "6h" {
		t.Fatalf("the console deploy wiped the declared policy, got %+v", app.BackupDeclared)
	}
}
