package state

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// legacyState is a state.json exactly as versions before the domain list wrote
// it: one `domain` string per app, no `domains` key anywhere.
//
// Written out in full rather than built with a struct, because the struct is
// the thing under test. If the field were renamed again tomorrow this literal
// would keep describing what is actually on the disk of a running host.
const legacyState = `{
  "version": 1,
  "baseDomain": "bay.alepha.dev",
  "apps": [
    {
      "name": "lore",
      "env": "production",
      "domain": "lore.alepha.dev",
      "release": "20260801T101500Z",
      "port": 4001,
      "runtime": "node",
      "backups": true,
      "lastBackupAt": "2026-08-02T04:17:00Z"
    },
    {
      "name": "docs",
      "env": "production",
      "domain": "docs.alepha.dev",
      "release": "20260731T090000Z",
      "port": 4002,
      "runtime": "node"
    }
  ]
}`

func TestLegacyDomainSurvivesUpgrade(t *testing.T) {
	// This is the test the whole change rests on. Bay reads this file at boot on
	// a host already serving traffic: if the domain did not carry over, the
	// first start after an upgrade would route nothing AND ask the CA for
	// nothing, so certificates would quietly lapse while the registry looked
	// healthy.
	path := filepath.Join(t.TempDir(), "state.json")
	if err := os.WriteFile(path, []byte(legacyState), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := Open(path)
	if err != nil {
		t.Fatalf("a pre-change state file must still load: %v", err)
	}

	t.Run("routing still resolves", func(t *testing.T) {
		app, ok := store.ByDomain("lore.alepha.dev")
		if !ok {
			t.Fatal("the legacy domain no longer routes")
		}
		if app.Key() != "lore/production" || app.Port != 4001 {
			t.Fatalf("wrong app or port: %+v", app)
		}
	})

	t.Run("on-demand issuance still recognises the host", func(t *testing.T) {
		// HasDomain is the guard in front of the CA. If it forgot these names,
		// renewal would stop without a single error in the log.
		for _, host := range []string{"lore.alepha.dev", "docs.alepha.dev"} {
			if !store.HasDomain(host) {
				t.Fatalf("%s would no longer be issued a certificate", host)
			}
		}
	})

	t.Run("everything else carried over", func(t *testing.T) {
		app, _ := store.Get("lore/production")
		if !app.Backups || app.LastBackupAt != "2026-08-02T04:17:00Z" || app.Release != "20260801T101500Z" {
			t.Fatalf("unrelated fields were lost: %+v", app)
		}
	})

	t.Run("the next write moves to the list form", func(t *testing.T) {
		app, _ := store.Get("lore/production")
		if err := store.Upsert(app); err != nil {
			t.Fatal(err)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(raw), `"domains"`) {
			t.Fatalf("expected the list form on disk, got:\n%s", raw)
		}
		// Reopening is what a restart does, and it must still route.
		reopened, err := Open(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := reopened.ByDomain("lore.alepha.dev"); !ok {
			t.Fatal("routing was lost on the round trip")
		}
	})
}

func TestMigrateDomains(t *testing.T) {
	t.Run("the list wins when a file carries both", func(t *testing.T) {
		// Only reachable if someone hand-edits, but picking the legacy value
		// there would quietly undo an edit made through Bay.
		var s State
		if err := json.Unmarshal([]byte(`{"apps":[{"domain":"old.test","domains":["new.test"]}]}`), &s); err != nil {
			t.Fatal(err)
		}
		s.migrateDomains()
		if len(s.Apps[0].Domains) != 1 || s.Apps[0].Domains[0] != "new.test" {
			t.Fatalf("want the list to win, got %v", s.Apps[0].Domains)
		}
	})

	t.Run("the legacy field is cleared so it is never written back", func(t *testing.T) {
		// Two sources of truth in one file is a reconciliation nobody should be
		// asked to do later.
		var s State
		if err := json.Unmarshal([]byte(`{"apps":[{"domain":"a.test"}]}`), &s); err != nil {
			t.Fatal(err)
		}
		s.migrateDomains()
		if s.Apps[0].LegacyDomain != "" {
			t.Fatalf("legacy field survived: %q", s.Apps[0].LegacyDomain)
		}
	})

	t.Run("no domain at all is a valid state", func(t *testing.T) {
		// An instance registered before a base domain was configured has nowhere
		// to be reached yet, and that is not corruption.
		var s State
		if err := json.Unmarshal([]byte(`{"apps":[{"name":"x","env":"production"}]}`), &s); err != nil {
			t.Fatal(err)
		}
		s.migrateDomains()
		if len(s.Apps[0].Domains) != 0 || s.Apps[0].Domain() != "" {
			t.Fatalf("want no domains, got %v", s.Apps[0].Domains)
		}
	})
}

func TestAppHasNoCustomUnmarshaller(t *testing.T) {
	// A guard against reintroducing the bug this design exists to avoid.
	//
	// A json.Unmarshaler on App is PROMOTED to every type that embeds it — the
	// control API's listedApp does — and a promoted unmarshaller decodes only
	// the fields it knows about, silently dropping everything the outer type
	// adds. That is how `bay top` came to report a running app as stopped.
	var app any = &App{}
	if _, ok := app.(json.Unmarshaler); ok {
		t.Fatal("App must not implement json.Unmarshaler: it would hijack decoding for every type that embeds it")
	}
	if _, ok := app.(json.Marshaler); ok {
		t.Fatal("App must not implement json.Marshaler, for the same reason")
	}
}

func TestDomainHelpers(t *testing.T) {
	app := App{Name: "club", Env: "production", Domains: []string{"club.example", "www.club.example"}}

	if app.Domain() != "club.example" {
		t.Fatalf("the canonical domain is the first, got %q", app.Domain())
	}
	for _, host := range app.Domains {
		if !app.Serves(host) {
			t.Fatalf("%s should be served", host)
		}
	}
	if app.Serves("other.example") {
		t.Fatal("an unrelated host must not match")
	}
	if (App{}).Domain() != "" {
		t.Fatal("an app with no domain must report an empty canonical")
	}
}

func TestEveryDomainRoutesAndIsClaimed(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Upsert(App{
		Name: "club", Env: "production",
		Domains: []string{"club.example", "www.club.example"},
		Port:    4010,
	}); err != nil {
		t.Fatal(err)
	}

	t.Run("a secondary domain routes as hard as the first", func(t *testing.T) {
		for _, host := range []string{"club.example", "www.club.example"} {
			app, ok := store.ByDomain(host)
			if !ok || app.Port != 4010 {
				t.Fatalf("%s did not route to the app", host)
			}
		}
	})

	t.Run("a secondary domain is claimed against other apps", func(t *testing.T) {
		// An unchecked secondary would shadow another app just as completely as
		// a canonical one.
		owner, taken := store.ClaimedBy("www.club.example")
		if !taken || owner != "club/production" {
			t.Fatalf("want club/production to own it, got %q %v", owner, taken)
		}
	})
}
