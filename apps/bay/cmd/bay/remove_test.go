package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

/*
Removing an app has to uninstall it, not just stop it.

`handleRemove` stopped the process and unregistered the app, and left the
systemd unit on disk with its `[Install]` symlink in place. The app was gone
until the machine rebooted, at which point systemd started something Bay no
longer had a record of — a domain served by an app that does not appear in
`bay list`, with nothing on the host to explain it.

These drive the real handler through the fake runner, so what is asserted is
that the server ASKS the supervisor to uninstall. What the systemd
implementation then does with that ask is pinned in
`internal/runner/systemdcmd_test.go`, which needs neither systemd nor Linux.
*/
func removeRequest(t *testing.T, srv *server, query string) *httptest.ResponseRecorder {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("DELETE /apps/{name}/{env}", srv.handleRemove)

	req := httptest.NewRequest(http.MethodDelete, "/apps/demo/production"+query, nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestRemoveUninstallsTheApp(t *testing.T) {
	f := newDeployFixture(t)
	if _, fail := f.deploy(deployableArtifact(t)); fail != nil {
		t.Fatalf("deploy: %v", fail)
	}

	rec := removeRequest(t, f.server, "")

	if rec.Code != http.StatusOK {
		t.Fatalf("remove answered %d: %s", rec.Code, rec.Body.String())
	}
	if len(f.runner.removes) != 1 {
		t.Fatalf("expected one Remove, got %d", len(f.runner.removes))
	}
	if got := f.runner.removes[0].key; got != "demo/production" {
		t.Errorf("Remove got key %q", got)
	}
}

/*
Without --purge the data stays, and so must the unix user that owns it.

Deleting the user here would leave a 0600 `.env` and a database owned by a bare
numeric uid, and `useradd --system` reuses freed uids — so the next app
provisioned on the host can be handed ownership of the previous one's secrets.
The bug report asked for `userdel` on every remove; this is the narrower version
and the reason is in `deleteUser`'s own doc.
*/
func TestRemoveWithoutPurgeKeepsTheUser(t *testing.T) {
	f := newDeployFixture(t)
	if _, fail := f.deploy(deployableArtifact(t)); fail != nil {
		t.Fatalf("deploy: %v", fail)
	}

	removeRequest(t, f.server, "")

	if len(f.runner.removes) != 1 {
		t.Fatalf("expected one Remove, got %d", len(f.runner.removes))
	}
	if f.runner.removes[0].purge {
		t.Error("purge was set on a remove that keeps the data")
	}
	instance := filepath.Join(f.root, "apps", "demo", "production")
	if _, err := os.Stat(instance); err != nil {
		t.Errorf("instance data was destroyed by a plain remove: %v", err)
	}
}

func TestRemoveWithPurgeCarriesTheFlagThrough(t *testing.T) {
	f := newDeployFixture(t)
	if _, fail := f.deploy(deployableArtifact(t)); fail != nil {
		t.Fatalf("deploy: %v", fail)
	}

	rec := removeRequest(t, f.server, "?purge=yes")

	if rec.Code != http.StatusOK {
		t.Fatalf("remove answered %d: %s", rec.Code, rec.Body.String())
	}
	if len(f.runner.removes) != 1 {
		t.Fatalf("expected one Remove, got %d", len(f.runner.removes))
	}
	if !f.runner.removes[0].purge {
		t.Error("purge was not carried through to the supervisor")
	}
	// Ordering, and it is the point: the user is deleted only once the files it
	// owned are gone, so there is never a moment where a live uid owns nothing
	// and orphaned files own no user.
	instance := filepath.Join(f.root, "apps", "demo", "production")
	if _, err := os.Stat(instance); !os.IsNotExist(err) {
		t.Errorf("purge left the instance directory behind: %v", err)
	}
}

/*
An app that was never registered must not reach the supervisor at all.

`Remove` disables a unit and, with purge, deletes a user; running either for a
name the caller invented is Bay acting on something it does not own.
*/
func TestRemoveUnknownAppUninstallsNothing(t *testing.T) {
	f := newDeployFixture(t)

	rec := removeRequest(t, f.server, "")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for an unknown app, got %d", rec.Code)
	}
	if len(f.runner.removes) != 0 {
		t.Errorf("uninstalled an app that was never registered: %v", f.runner.removes)
	}
}
