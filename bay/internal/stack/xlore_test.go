package stack

import (
	"strings"
	"testing"
)

func TestParseXLore(t *testing.T) {
	t.Run("every field parses", func(t *testing.T) {
		x, err := parseXLore("api", map[string]any{
			"app": "api", "routes": []any{"@", "www"}, "port": 3000,
			"runtime": "node:26-alpine", "tcp": 8883,
			"backup": map[string]any{"postgres": map[string]any{"user": "u", "db": "d"}},
		})
		if err != nil {
			t.Fatal(err)
		}
		if x.App != "api" || len(x.Routes) != 2 || x.Port != 3000 || x.Runtime != "node:26-alpine" ||
			x.TCP != 8883 || x.Backup.Postgres.DB != "d" {
			t.Fatalf("x = %+v", x)
		}
	})

	t.Run("a generic backup command parses", func(t *testing.T) {
		x, err := parseXLore("mongo", map[string]any{"backup": map[string]any{"command": "mongodump --archive"}})
		if err != nil || x.Backup.Command != "mongodump --archive" {
			t.Fatalf("x = %+v, err = %v", x, err)
		}
	})

	t.Run("a typo, a full domain or a malformed value is refused with the service", func(t *testing.T) {
		cases := map[string]map[string]any{
			"is not a field":         {"route": []any{"@"}},
			"is a full domain":       {"routes": []any{"analytics.bob.dev"}},
			"is not a label":         {"routes": []any{"Auth_1"}},
			"must be a port number":  {"tcp": 70000},
			"only applies to an app": {"runtime": "node:26-alpine"},
			"takes no other key":     {"backup": map[string]any{"postgres": map[string]any{}, "command": "x"}},
			"name the app":           {"app": ""},
		}
		for want, raw := range cases {
			_, err := parseXLore("svc", raw)
			if err == nil || !strings.Contains(err.Error(), want) || !strings.Contains(err.Error(), "service svc") {
				t.Errorf("%v: err = %v, want %q", raw, err, want)
			}
		}
	})

	t.Run("labels resolve against the base domain", func(t *testing.T) {
		if ResolveRoute("@", "mcs-staging.alepha.dev") != "mcs-staging.alepha.dev" ||
			ResolveRoute("auth", "mcs-staging.alepha.dev") != "auth.mcs-staging.alepha.dev" {
			t.Fatal("route resolution")
		}
	})
}

func TestLoreRefusesAServiceDependingOnAnApp(t *testing.T) {
	requireCompose(t)
	dir := bundleDir(t, map[string]string{"compose.yml": `services:
  api:
    x-lore: {app: api}
  worker:
    image: busybox
    depends_on: [api]
`})
	l, err := Load(dir, "mcs-staging", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := l.Lore(); err == nil || !strings.Contains(err.Error(), "worker depends on api") {
		t.Fatalf("err = %v", err)
	}
}

func TestParseBackupRestore(t *testing.T) {
	t.Run("a command hook may declare its restore", func(t *testing.T) {
		b, err := parseBackup(map[string]any{"command": "mongodump --archive", "restore": "mongorestore --archive --drop"})
		if err != nil || b.Restore != "mongorestore --archive --drop" {
			t.Fatalf("%+v %v", b, err)
		}
	})
	t.Run("postgres takes no other key, and unknown keys are refused", func(t *testing.T) {
		for _, raw := range []map[string]any{
			{"postgres": map[string]any{"user": "u", "db": "d"}, "restore": "x"},
			{"command": "dump", "restor": "x"},
			{"restore": "x"},
		} {
			if _, err := parseBackup(raw); err == nil {
				t.Fatalf("%v accepted", raw)
			}
		}
	})
}
