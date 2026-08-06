package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// setEnv drives the control API's handler the way `bay env set` does.
func setEnv(t *testing.T, f *deployFixture, payload string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/apps/demo/production/env", strings.NewReader(payload))
	req.SetPathValue("name", "demo")
	req.SetPathValue("env", "production")
	rec := httptest.NewRecorder()
	f.server.handleSetEnv(rec, req)
	return rec
}

func listEnv(t *testing.T, f *deployFixture) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/apps/demo/production/env", nil)
	req.SetPathValue("name", "demo")
	req.SetPathValue("env", "production")
	rec := httptest.NewRecorder()
	f.server.handleListEnv(rec, req)
	return rec
}

// deployedApp is a running app with the `.env` a real provision wrote.
func deployedApp(t *testing.T) *deployFixture {
	t.Helper()
	f := newDeployFixture(t)
	if _, derr := f.deploy(deployableArtifact(t)); derr != nil {
		t.Fatalf("fixture deploy failed: %v", derr)
	}
	return f
}

func decodeEnvResponse(t *testing.T, rec *httptest.ResponseRecorder) envResponse {
	t.Helper()
	var out envResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("response is not the documented shape: %v (%s)", err, rec.Body)
	}
	return out
}

func TestEnvSetReachesTheRunningProcess(t *testing.T) {
	/*
		The whole point. An env var written to a file the running process read
		at boot has not been set — it is a no-op that reports success, which is
		the exact bug `BayAdapter.secrets()` being a no-op was.

		`lastSpec.Env` is what the supervisor was actually asked to run with, so
		this is the only assertion that distinguishes "written" from "in
		effect".
	*/
	f := deployedApp(t)
	before := f.runner.lastSpec.Env["STRIPE_KEY"]
	if before != "" {
		t.Fatalf("the fixture should start with no STRIPE_KEY, got %q", before)
	}

	rec := setEnv(t, f, "STRIPE_KEY=sk_live_1\n")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body)
	}
	out := decodeEnvResponse(t, rec)
	if !out.Restarted {
		t.Fatalf("a changed value must restart the app, got %+v", out)
	}
	if got := f.runner.lastSpec.Env["STRIPE_KEY"]; got != "sk_live_1" {
		t.Fatalf("the new value never reached the process: %q", got)
	}
}

func TestEnvSetDoesNotRestartWhenNothingChanged(t *testing.T) {
	// `alepha platform up` pushes the same secrets on every deploy. Restarting
	// for a file that did not move would buy an outage window for nothing —
	// and the answer says so rather than leaving it to be inferred.
	f := deployedApp(t)
	if rec := setEnv(t, f, "STRIPE_KEY=sk_live_1\n"); rec.Code != http.StatusOK {
		t.Fatalf("first set: %d %s", rec.Code, rec.Body)
	}
	starts := f.runner.starts

	rec := setEnv(t, f, "STRIPE_KEY=sk_live_1\n")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body)
	}
	out := decodeEnvResponse(t, rec)
	if out.Restarted || len(out.Changed) != 0 {
		t.Fatalf("an identical push changes nothing, got %+v", out)
	}
	if out.Note == "" {
		t.Fatal("a false `restarted` must be explained, never left bare")
	}
	if f.runner.starts != starts {
		t.Fatalf("the app was restarted for nothing: %d -> %d", starts, f.runner.starts)
	}
}

func TestEnvSetRefusesToOverwriteAppSecret(t *testing.T) {
	// Bay generates APP_SECRET once per instance and never regenerates it: a
	// new value signs every user out, and the one it replaced is gone.
	f := deployedApp(t)
	envPath := filepath.Join(f.root, "apps", "demo", "production", ".env")
	before, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}

	rec := setEnv(t, f, "APP_SECRET=attacker\n")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), "APP_SECRET") {
		t.Fatalf("the refusal must name the key: %s", rec.Body)
	}
	after, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) {
		t.Fatal("a refused set must leave the .env byte-identical")
	}
}

func TestEnvSetRefusesAnUnknownApp(t *testing.T) {
	f := newDeployFixture(t)

	rec := setEnv(t, f, "STRIPE_KEY=sk\n")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for an app that was never deployed, got %d: %s", rec.Code, rec.Body)
	}
}

func TestEnvSetRefusesAnEmptyPayload(t *testing.T) {
	// "Pushed nothing" must not be reported the same way as "pushed".
	f := deployedApp(t)

	rec := setEnv(t, f, "\n# nothing here\n")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a payload with no assignments, got %d: %s", rec.Code, rec.Body)
	}
}

func TestEnvSetRefusesAStaticSite(t *testing.T) {
	// A static site has no process and no `.env`. A variable set on one would
	// sit in a file nothing ever reads.
	f := newDeployFixture(t)
	if _, derr := f.server.deployArtifact(t.Context(), deployArtifactOptions{
		Artifact: staticArtifact(t), Name: "demo", Env: "production",
	}); derr != nil {
		t.Fatalf("static deploy failed: %v", derr)
	}

	rec := setEnv(t, f, "STRIPE_KEY=sk\n")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a static site, got %d: %s", rec.Code, rec.Body)
	}
	if !strings.Contains(rec.Body.String(), "no process") {
		t.Fatalf("the refusal must say why: %s", rec.Body)
	}
}

func TestEnvListReportsNamesAndNeverValues(t *testing.T) {
	// The same rule `GET /config/storage` follows: something that can already
	// call this API must not be able to read credentials out of it.
	f := deployedApp(t)
	if rec := setEnv(t, f, "STRIPE_KEY=sk_live_secret\n"); rec.Code != http.StatusOK {
		t.Fatalf("set failed: %d %s", rec.Code, rec.Body)
	}

	rec := listEnv(t, f)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "STRIPE_KEY") {
		t.Fatalf("a configured key must be reported: %s", body)
	}
	if strings.Contains(body, "sk_live_secret") {
		t.Fatalf("a value must never be echoed back: %s", body)
	}

	var out struct {
		App      []string `json:"app"`
		BayOwned []string `json:"bayOwned"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.App) != 1 || out.App[0] != "STRIPE_KEY" {
		t.Fatalf("app-owned keys should be exactly the ones someone set, got %v", out.App)
	}
	if len(out.BayOwned) == 0 {
		t.Fatal("Bay's own keys are set on every instance and must be reported as its")
	}
}

func TestEnvSetRefusesAValueOnTheCommandLine(t *testing.T) {
	// argv is visible in `ps` to every user on the host and lands in the
	// caller's shell history. The refusal has to say that, because otherwise
	// the caller gets "no such file or directory: FOO=bar".
	err := cmdEnvSet([]string{"demo/production", "STRIPE_KEY=sk_live"})
	if err == nil {
		t.Fatal("a KEY=VALUE argument must be refused")
	}
	if !strings.Contains(err.Error(), "stdin") || !strings.Contains(err.Error(), "ps") {
		t.Fatalf("the refusal must name both the channel and the reason, got: %v", err)
	}
}

// deployWithSecrets runs the real deploy sequence with a secrets file beside
// the artifact, exactly as `bay deploy --secrets-file` does.
func deployWithSecrets(t *testing.T, f *deployFixture, body string, mode os.FileMode) (string, *deployOutcome, *deployFailure) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "secrets")
	if err := os.WriteFile(path, []byte(body), mode); err != nil {
		t.Fatal(err)
	}
	out, derr := f.server.deployArtifact(t.Context(), deployArtifactOptions{
		Artifact: deployableArtifact(t), Name: "demo", Env: "production",
		SecretsFile: path,
	})
	return path, out, derr
}

func TestTheAppBootsWithItsSecretsOnAFirstDeploy(t *testing.T) {
	/*
		The whole reason `--secrets-file` exists. Pushed after the deploy, the
		app starts once without its secrets and a failure at that step lands
		after the code already has. Merged during provision, the very first
		process ever started for this release has them.

		`lastSpec.Env` is what the supervisor was actually asked to run with —
		the only assertion that tells "in the .env" from "in the process".
	*/
	f := newDeployFixture(t)

	_, _, derr := deployWithSecrets(t, f, "STRIPE_KEY=sk_live_1\n", 0o600)
	if derr != nil {
		t.Fatalf("deploy failed: %v", derr)
	}

	if got := f.runner.lastSpec.Env["STRIPE_KEY"]; got != "sk_live_1" {
		t.Fatalf("the first process must already have the secret, got %q", got)
	}
	// One start, not two. A second would mean the app booted once without
	// them — precisely the window this closes.
	if f.runner.starts != 1 {
		t.Fatalf("expected exactly one start, got %d", f.runner.starts)
	}
}

func TestTheSecretsFileIsGoneWhetherOrNotTheDeployWorked(t *testing.T) {
	f := newDeployFixture(t)

	path, _, derr := deployWithSecrets(t, f, "STRIPE_KEY=sk_live_1\n", 0o600)
	if derr != nil {
		t.Fatalf("deploy failed: %v", derr)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("a successful deploy left the secrets file behind: %v", err)
	}
}

func TestARefusedSecretsFileStopsTheDeployBeforeItTouchesAnything(t *testing.T) {
	/*
		Consumed before the hold, before the stop, before a byte is unpacked.
		A validation must not be the thing that takes an app down: the running
		release keeps serving and the refusal costs the caller nothing but the
		round trip.
	*/
	f := newDeployFixture(t)
	if _, derr := f.deploy(deployableArtifact(t)); derr != nil {
		t.Fatalf("the first deploy should succeed: %v", derr)
	}
	before := f.storedRelease(t)
	starts := f.runner.starts

	path, _, derr := deployWithSecrets(t, f, "APP_SECRET=attacker\n", 0o600)
	if derr == nil {
		t.Fatal("a secrets file naming a Bay-owned key must refuse the deploy")
	}
	if derr.Status != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %v", derr.Status, derr)
	}
	if !f.runner.Running("demo/production") {
		t.Fatal("the previous release must still be serving")
	}
	if f.runner.starts != starts {
		t.Fatalf("nothing should have been restarted: %d -> %d", starts, f.runner.starts)
	}
	if f.storedRelease(t) != before {
		t.Fatalf("the release moved: %s -> %s", before, f.storedRelease(t))
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("a refused deploy left the secrets file behind: %v", err)
	}
}

func TestSecretsSurviveTheNextDeployThatCarriesNone(t *testing.T) {
	// Merge, never replace — the same contract the instance `.env` has always
	// had. A redeploy that changes no configuration must not wipe it.
	f := newDeployFixture(t)
	if _, _, derr := deployWithSecrets(t, f, "STRIPE_KEY=sk_live_1\n", 0o600); derr != nil {
		t.Fatalf("first deploy failed: %v", derr)
	}

	if _, derr := f.deploy(deployableArtifact(t)); derr != nil {
		t.Fatalf("second deploy failed: %v", derr)
	}

	if got := f.runner.lastSpec.Env["STRIPE_KEY"]; got != "sk_live_1" {
		t.Fatalf("a plain redeploy lost the secret: %q", got)
	}
}

func TestAStaticSiteRefusesASecretsFileRatherThanDropIt(t *testing.T) {
	// It has no `.env` and no process, so there is nowhere for these to go.
	// Accepting them would report success while discarding an app's
	// credentials — the silent class this whole line of work removes.
	f := newDeployFixture(t)
	path := filepath.Join(t.TempDir(), "secrets")
	if err := os.WriteFile(path, []byte("STRIPE_KEY=sk\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	_, derr := f.server.deployArtifact(t.Context(), deployArtifactOptions{
		Artifact: staticArtifact(t), Name: "demo", Env: "production",
		SecretsFile: path,
	})
	if derr == nil {
		t.Fatal("a static site must refuse a secrets file")
	}
	if !strings.Contains(derr.Error(), "static site") {
		t.Fatalf("the refusal must say why, got: %v", derr)
	}
}
