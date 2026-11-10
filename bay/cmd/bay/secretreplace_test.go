package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/deploy"
	"github.com/alepha-dev/bay/internal/state"
)

func (f *deployFixture) replaceSecret(t *testing.T, name, query, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/apps/demo/production/secret/"+name+query, strings.NewReader(body))
	req.SetPathValue("name", "demo")
	req.SetPathValue("env", "production")
	req.SetPathValue("key", name)
	rec := httptest.NewRecorder()
	f.server.handleReplaceSecret(rec, req)
	return rec
}

func TestSecretReplaceNeedsTheConfirmationTheControlAPIEnforces(t *testing.T) {
	f := newDeployFixture(t)
	if _, failure := f.deploy(deployableArtifact(t)); failure != nil {
		t.Fatal(failure)
	}
	before := runningKey(t, f)

	rec := f.replaceSecret(t, "APP_SECRET", "", "the-old-host-key-0123456789")

	if rec.Code != http.StatusPreconditionRequired || !strings.Contains(rec.Body.String(), "signs every session out") {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	if runningKey(t, f) != before {
		t.Fatal("an unconfirmed replace wrote the key")
	}
}

func TestSecretReplaceIsForAppSecretOnly(t *testing.T) {
	f := newDeployFixture(t)
	if _, failure := f.deploy(deployableArtifact(t)); failure != nil {
		t.Fatal(failure)
	}

	if rec := f.replaceSecret(t, "DATABASE_URL", "?confirm=yes", "x"); rec.Code != http.StatusBadRequest {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	if rec := f.replaceSecret(t, "APP_SECRET", "?confirm=yes", "has a space"); rec.Code != http.StatusBadRequest {
		t.Fatalf("a value that cannot be a key: %d %s", rec.Code, rec.Body)
	}
}

// The 2026-11-10 repair: the old host's key, kept aside, put back on purpose.
func TestSecretReplacePutsTheKeyBackRestartsAndIsAudited(t *testing.T) {
	f := newDeployFixture(t)
	if _, failure := f.deploy(deployableArtifact(t)); failure != nil {
		t.Fatal(failure)
	}
	starts := f.runner.starts

	rec := f.replaceSecret(t, "APP_SECRET", "?confirm=yes", "the-old-host-key-0123456789\n")

	if rec.Code != http.StatusOK {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	if got := runningKey(t, f); got != "the-old-host-key-0123456789" {
		t.Fatalf("key %q", got)
	}
	body := decode(t, rec)
	if body["restarted"] != true || f.runner.starts <= starts {
		t.Fatalf("a running app restarts on the new key: %v", body)
	}
	if lore, _ := body["lore"].(string); !strings.Contains(lore, "previous key until the next deploy") {
		t.Fatalf("the answer says Lore follows on the next deploy: %v", body)
	}
	if st := f.app(t).AppSecret; st == nil || st.Source != state.SecretReplaced || st.By != "cli" {
		t.Fatalf("recorded %+v", st)
	}
	raw, _ := os.ReadFile(filepath.Join(f.root, "state.json"))
	if strings.Contains(string(raw)+rec.Body.String(), "the-old-host-key") {
		t.Fatal("the key is in state.json or the answer")
	}

	again := f.replaceSecret(t, "APP_SECRET", "?confirm=yes", "the-old-host-key-0123456789")
	if decode(t, again)["replaced"] != false {
		t.Fatalf("the same key twice is no change: %s", again.Body)
	}
}

func TestSecretReplaceDoesNotStartAStoppedApp(t *testing.T) {
	f := newDeployFixture(t)
	if _, failure := f.deploy(deployableArtifact(t)); failure != nil {
		t.Fatal(failure)
	}
	_ = f.runner.Stop("demo/production", 0)

	rec := f.replaceSecret(t, "APP_SECRET", "?confirm=yes", "the-old-host-key-0123456789")

	if decode(t, rec)["restarted"] != false || f.runner.Running("demo/production") {
		t.Fatalf("got %s", rec.Body)
	}
}

// The one door: the other ways in keep refusing the name.
func TestEnvSetAndSecretsFilesStillRefuseAppSecret(t *testing.T) {
	f := newDeployFixture(t)
	if _, failure := f.deploy(deployableArtifact(t)); failure != nil {
		t.Fatal(failure)
	}
	if _, err := deploy.SetEnv(f.server.instanceDir(f.app(t)), map[string]string{"APP_SECRET": "x"}); err == nil {
		t.Fatal("bay env set must refuse APP_SECRET")
	}
}

func TestTheReplaceCommandReadsTheKeyFromStdinOnly(t *testing.T) {
	err := cmdSecretReplace([]string{"demo/production", "APP_SECRET", "the-key-on-the-command-line"})
	if err == nil || !strings.Contains(err.Error(), "stdin") {
		t.Fatalf("got %v", err)
	}
}
