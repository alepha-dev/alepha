package state

import (
	"os"
	"path/filepath"
	"testing"
)

// stateBeforeStatic is a state.json exactly as versions before static hosting
// wrote it: no `static` key on any app.
//
// Written out in full rather than built with a struct, for the same reason the
// legacy-domain fixture is: the struct is the thing under test.
const stateBeforeStatic = `{
  "version": 1,
  "baseDomain": "bay.alepha.dev",
  "apps": [
    {
      "name": "lore",
      "env": "production",
      "domains": ["lore.alepha.dev"],
      "release": "20260801T101500Z",
      "port": 4001,
      "runtime": "node"
    }
  ]
}`

func TestAppsDeployedBeforeStaticHostingAreNotStatic(t *testing.T) {
	// Bay reads this file at boot on a host already serving traffic. If an
	// absent key read as static, every app on that host would stop being
	// supervised the moment Bay restarted.
	path := filepath.Join(t.TempDir(), "state.json")
	if err := os.WriteFile(path, []byte(stateBeforeStatic), 0o600); err != nil {
		t.Fatal(err)
	}

	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}

	app, ok := store.Get("lore/production")
	if !ok {
		t.Fatal("app should have loaded")
	}
	if app.Static {
		t.Fatal("an app with no `static` key is a process app, not a static site")
	}
}

func TestStaticSurvivesARestart(t *testing.T) {
	// The proxy branches on this field on every request, so it has to come back
	// from disk — recomputing it would mean re-reading the manifest per request.
	path := filepath.Join(t.TempDir(), "state.json")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Upsert(App{
		Name: "docs", Env: "production", Runtime: "static", Static: true,
	}); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}

	app, ok := reopened.Get("docs/production")
	if !ok {
		t.Fatal("app should have loaded")
	}
	if !app.Static {
		t.Fatal("static must survive a restart")
	}
}
