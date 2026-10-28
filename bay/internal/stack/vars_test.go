package stack

import (
	"os"
	"strings"
	"testing"
)

func TestVars(t *testing.T) {
	t.Run("set merges, answers what changed, and writes 0600", func(t *testing.T) {
		root := t.TempDir()
		changed, err := SetVars(root, "umami", "production", map[string]string{"APP_SECRET": "a$b'c\"d", "X": "1"})
		if err != nil || strings.Join(changed, ",") != "APP_SECRET,X" {
			t.Fatalf("changed = %v, err = %v", changed, err)
		}
		again, _ := SetVars(root, "umami", "production", map[string]string{"X": "1"})
		if len(again) != 0 {
			t.Fatalf("an unchanged value was reported changed: %v", again)
		}
		vars, _ := LoadVars(root, "umami", "production")
		if vars["APP_SECRET"] != "a$b'c\"d" {
			t.Fatalf("value did not round-trip: %q", vars["APP_SECRET"])
		}
		info, _ := os.Stat(VarsFile(root, "umami", "production"))
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("mode = %v", info.Mode().Perm())
		}
		if names, _ := VarNames(root, "umami", "production"); strings.Join(names, ",") != "APP_SECRET,X" {
			t.Fatalf("names = %v", names)
		}
	})

	t.Run("unset removes and answers what existed", func(t *testing.T) {
		root := t.TempDir()
		_, _ = SetVars(root, "a", "production", map[string]string{"X": "1"})
		removed, err := UnsetVars(root, "a", "production", []string{"X", "NOPE"})
		if err != nil || strings.Join(removed, ",") != "X" {
			t.Fatalf("removed = %v, err = %v", removed, err)
		}
	})

	t.Run("a malformed name is refused", func(t *testing.T) {
		if _, err := SetVars(t.TempDir(), "a", "production", map[string]string{"1BAD": "x"}); err == nil {
			t.Fatal("accepted")
		}
	})

	t.Run("an app service: Bay's keys, then the app's, then the stack's", func(t *testing.T) {
		env := AppEnv(
			map[string]string{"APP_SECRET": "from-stack", "LOG_LEVEL": "info", "REDIS_URL": "redis://redis"},
			map[string]string{"APP_SECRET": "bay-owned", "LOG_LEVEL": "debug"},
		)
		if env["APP_SECRET"] != "bay-owned" || env["LOG_LEVEL"] != "debug" || env["REDIS_URL"] != "redis://redis" {
			t.Fatalf("env = %v", env)
		}
	})

	t.Run("a stack's own database replaces the SQLite Bay provisioned", func(t *testing.T) {
		env := AppEnv(
			map[string]string{"DATABASE_URL": "postgres://app:pw@db:5432/app"},
			map[string]string{"DATABASE_URL": "sqlite:///apps/demo/data/app.db"},
		)
		if env["DATABASE_URL"] != "postgres://app:pw@db:5432/app" {
			t.Fatalf("env = %v", env)
		}
		env = AppEnv(
			map[string]string{"DATABASE_URL": "postgres://stack"},
			map[string]string{"DATABASE_URL": "postgres://the-app-s-own"},
		)
		if env["DATABASE_URL"] != "postgres://the-app-s-own" {
			t.Fatalf("an app's own non-SQLite URL still wins: %v", env)
		}
	})
}
