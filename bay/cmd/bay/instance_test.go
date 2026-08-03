package main

import (
	"testing"
	"time"
)

func TestInstanceFromArgs(t *testing.T) {
	cases := []struct {
		name     string
		args     []string
		wantApp  string
		wantEnv  string
		wantFail bool
	}{
		{name: "app/env positional", args: []string{"lore/production"}, wantApp: "lore", wantEnv: "production"},
		{name: "bare app defaults to production", args: []string{"lore"}, wantApp: "lore", wantEnv: "production"},
		{name: "flag pair", args: []string{"--name", "lore", "--env", "staging"}, wantApp: "lore", wantEnv: "staging"},
		// Found by running it on a real host. --control-socket is handled
		// globally, so nothing local mentioned it, and its value parsed as an
		// instance with an empty name.
		{
			name:    "the control socket path is not an instance",
			args:    []string{"lore/production", "--control-socket", "/run/bay/control.sock"},
			wantApp: "lore", wantEnv: "production",
		},
		{
			name:    "an unknown flag's value is skipped, not read as the app",
			args:    []string{"lore", "--some-future-flag", "value/with-slash"},
			wantApp: "lore", wantEnv: "production",
		},
		{
			name:    "a boolean flag does not swallow the positional after it",
			args:    []string{"--json", "lore/staging"},
			wantApp: "lore", wantEnv: "staging",
		},
		{name: "flags before positional", args: []string{"-n", "50", "lore"}, wantApp: "lore", wantEnv: "production"},
		{name: "json flag only", args: []string{"--json"}, wantFail: true},
		{name: "nothing", args: nil, wantFail: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app, env, err := instanceFromArgs(tc.args)
			if tc.wantFail {
				if err == nil {
					t.Fatalf("want an error, got %s/%s", app, env)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if app != tc.wantApp || env != tc.wantEnv {
				t.Fatalf("want %s/%s, got %s/%s", tc.wantApp, tc.wantEnv, app, env)
			}
		})
	}
}

func TestUptimeOf(t *testing.T) {
	t.Run("empty when the supervisor said nothing", func(t *testing.T) {
		// "up 0s" would read as an app that just restarted — a much louder
		// claim than "I do not know".
		if got := uptimeOf(time.Time{}); got != "" {
			t.Fatalf("want empty, got %q", got)
		}
	})

	t.Run("rounds to the second", func(t *testing.T) {
		if got := uptimeOf(time.Now().Add(-90 * time.Second)); got != "1m30s" {
			t.Fatalf("want 1m30s, got %q", got)
		}
	})
}
