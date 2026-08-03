package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/alepha/bay/internal/runner"
	"github.com/alepha/bay/internal/state"
)

func TestListedAppDecodesTheFieldsItAdds(t *testing.T) {
	// The regression that only a real host revealed. listedApp embeds state.App;
	// when App grew a custom UnmarshalJSON, that method was promoted and decoded
	// only App's own fields — so `running` and `usage` silently became zero, and
	// every live app was reported as stopped by both `bay top` and `bay status`.
	payload := `[{
		"name": "pulse", "env": "production",
		"domains": ["admin.bay.alepha.dev"],
		"port": 40913, "running": true,
		"usage": {"memoryBytes": 145432576, "restarts": 2}
	}]`

	var apps []listedApp
	if err := json.Unmarshal([]byte(payload), &apps); err != nil {
		t.Fatal(err)
	}
	if len(apps) != 1 {
		t.Fatalf("want 1 app, got %d", len(apps))
	}
	got := apps[0]
	if !got.Running {
		t.Fatal("running was dropped — an embedded unmarshaller is eating the outer fields")
	}
	if got.Usage == nil || got.Usage.Restarts != 2 {
		t.Fatalf("usage was dropped, got %+v", got.Usage)
	}
	// And the embedded fields still arrive.
	if got.Name != "pulse" || got.Port != 40913 || got.Domain() != "admin.bay.alepha.dev" {
		t.Fatalf("embedded fields were lost: %+v", got.App)
	}
}

func TestIdleFor(t *testing.T) {
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		name string
		at   time.Time
		want string
	}{
		{name: "seconds", at: now.Add(-30 * time.Second), want: "30s"},
		{name: "minutes", at: now.Add(-90 * time.Minute), want: "1h30m0s"},
		{name: "days", at: now.Add(-92 * 24 * time.Hour), want: "92d"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := idleFor(tc.at.Format(time.RFC3339), now); got != tc.want {
				t.Fatalf("want %q, got %q", tc.want, got)
			}
		})
	}

	t.Run("empty for an absent stamp", func(t *testing.T) {
		if got := idleFor("", now); got != "" {
			t.Fatalf("want empty, got %q", got)
		}
	})

	t.Run("empty for an unparseable stamp", func(t *testing.T) {
		// So the caller can print the raw value rather than an invented age.
		if got := idleFor("last tuesday", now); got != "" {
			t.Fatalf("want empty, got %q", got)
		}
	})

	t.Run("a future stamp is a clock problem, not a negative age", func(t *testing.T) {
		if got := idleFor(now.Add(time.Hour).Format(time.RFC3339), now); got != "0s" {
			t.Fatalf("want 0s, got %q", got)
		}
	})
}

func TestTrafficLine(t *testing.T) {
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)

	t.Run("spells out never", func(t *testing.T) {
		// The single most likely thing on a shared host to be safe to delete,
		// and the operator should read the sentence before they do it.
		got := trafficLine(listedApp{}, now)
		if !strings.Contains(got, "never") {
			t.Fatalf("want never, got %q", got)
		}
	})

	t.Run("names crons, because they change what silence means", func(t *testing.T) {
		// An app whose whole job is a weekly email answers no requests and is
		// not abandoned.
		got := trafficLine(listedApp{App: state.App{Crons: 2}}, now)
		if !strings.Contains(got, "2 cron(s)") {
			t.Fatalf("want the cron count, got %q", got)
		}
	})

	t.Run("renders an age", func(t *testing.T) {
		app := listedApp{App: state.App{LastRequestAt: now.Add(-3 * time.Second).Format(time.RFC3339)}}
		if got := trafficLine(app, now); got != "3s ago" {
			t.Fatalf("want 3s ago, got %q", got)
		}
	})

	t.Run("falls back to the raw stamp it cannot parse", func(t *testing.T) {
		app := listedApp{App: state.App{LastRequestAt: "not a date"}}
		if got := trafficLine(app, now); got != "not a date" {
			t.Fatalf("want the raw value, got %q", got)
		}
	})
}

func TestPrintStatusJSONProblems(t *testing.T) {
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)

	t.Run("a healthy app reports no problems and exits zero", func(t *testing.T) {
		healthy := []listedApp{{
			App: state.App{
				Name: "lore", Env: "production", Backups: true,
				LastBackupAt: now.Add(-time.Hour).Format(time.RFC3339),
			},
			Running: true,
			Usage:   &runner.Usage{StartedAt: now.Add(-time.Hour)},
		}}
		if err := printStatusJSON(healthy, now, 24*time.Hour); err != nil {
			t.Fatalf("a healthy app must exit zero, got %v", err)
		}
	})

	t.Run("a stopped app fails the command", func(t *testing.T) {
		// Same non-zero exit as the human view: a script that switched to --json
		// to be simpler must not silently stop noticing.
		stopped := []listedApp{{App: state.App{Name: "lore", Env: "production"}}}
		if err := printStatusJSON(stopped, now, 24*time.Hour); err == nil {
			t.Fatal("want a non-zero exit for a stopped app")
		}
	})

	t.Run("a stale backup fails the command", func(t *testing.T) {
		stale := []listedApp{{
			App: state.App{
				Name: "lore", Env: "production", Backups: true,
				LastBackupAt: now.Add(-100 * time.Hour).Format(time.RFC3339),
			},
			Running: true,
		}}
		if err := printStatusJSON(stale, now, 24*time.Hour); err == nil {
			t.Fatal("want a non-zero exit for a stale backup")
		}
	})

	t.Run("an app with no Bay-managed database is not a problem", func(t *testing.T) {
		// A permanent warning that is also wrong is how people learn to ignore
		// warnings.
		byo := []listedApp{{
			App:     state.App{Name: "lore", Env: "production", Backups: false},
			Running: true,
		}}
		if err := printStatusJSON(byo, now, 24*time.Hour); err != nil {
			t.Fatalf("BYO database must not be a problem, got %v", err)
		}
	})
}
