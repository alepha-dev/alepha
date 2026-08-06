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
