package deploy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/state"
)

func TestAStackMayBringItsOwnDatabase(t *testing.T) {
	// A member app of a stack whose variables carry a DATABASE_URL (the
	// stack's Postgres) is the user bringing a database: Bay provisions no
	// SQLite for it, and drops the one an earlier deploy left in its .env, so
	// the stack's reaches the app.
	databaseArtifact := func() string {
		return buildArchive(t,
			entry{name: "manifest.json", body: `{
				"project": "demo",
				"runtimes": [{"runtime": "node", "entry": "index.js"}],
				"resources": { "hasDatabase": true }
			}`},
			entry{name: "index.node.js", body: "process.exit(0)"},
		)
	}
	deployWith := func(t *testing.T, root string, vars map[string]string) (*Result, error) {
		store, err := state.Open(filepath.Join(root, "state.json"))
		if err != nil {
			t.Fatal(err)
		}
		return Run(Options{Root: root, Artifact: databaseArtifact(), Name: "demo", Env: "production",
			BaseDomain: "bay.test", StackVars: vars}, store)
	}
	dataFile := func(root string) string {
		return filepath.Join(root, "apps", naming.Instance("demo", "production"), "data", "app.db")
	}

	t.Run("no SQLite when the stack names its database", func(t *testing.T) {
		root := t.TempDir()
		if _, err := deployWith(t, root, map[string]string{"DATABASE_URL": "postgres://app:pw@db:5432/app"}); err != nil {
			t.Fatal(err)
		}
		if env := envOf(t, root); strings.Contains(env, "DATABASE_URL") {
			t.Fatalf("the .env must leave DATABASE_URL to the stack:\n%s", env)
		}
		if _, err := os.Stat(dataFile(root)); !os.IsNotExist(err) {
			t.Fatalf("Bay created a SQLite file it does not own: %v", err)
		}
	})

	t.Run("a SQLite URL from an earlier deploy gives way", func(t *testing.T) {
		root := t.TempDir()
		if _, err := deployWith(t, root, nil); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(envOf(t, root), "DATABASE_URL=sqlite://") {
			t.Fatal("the first deploy, before the stack names a database, gets SQLite")
		}
		if _, err := deployWith(t, root, map[string]string{"DATABASE_URL": "postgres://app:pw@db:5432/app"}); err != nil {
			t.Fatal(err)
		}
		if env := envOf(t, root); strings.Contains(env, "DATABASE_URL") {
			t.Fatalf("Bay's SQLite URL survived:\n%s", env)
		}
	})

	t.Run("a stack without one leaves Bay's SQLite alone", func(t *testing.T) {
		root := t.TempDir()
		if _, err := deployWith(t, root, map[string]string{"REDIS_URL": "redis://redis:6379"}); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(envOf(t, root), "DATABASE_URL=sqlite://") {
			t.Fatal("SQLite expected")
		}
	})
}
