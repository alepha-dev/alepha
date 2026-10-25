package main

import "testing"

// The whole point of checkFlags is that a typo stops the command instead of
// changing what it does, so these cases are the ones that used to pass silently.
func TestCheckFlags(t *testing.T) {
	boolFlags := map[string]bool{"--tls": true}
	valueFlags := map[string]bool{"--root": true, "--base-domain": true}

	cases := []struct {
		name    string
		args    []string
		wantErr bool
	}{
		{"empty", nil, false},
		{"known bool", []string{"--tls"}, false},
		{"known value", []string{"--root", "/srv"}, false},
		{"mixed", []string{"--root", "/srv", "--tls", "--base-domain", "x.dev"}, false},
		{"positional arg is not a flag", []string{"app.tar.gz", "--tls"}, false},
		// The bug this exists for: a misspelling used to leave the real flag
		// unset and start anyway.
		{"typo", []string{"--base-domian", "x.dev"}, true},
		{"unknown bool", []string{"--force"}, true},
		// A value that looks like a flag must be consumed as a value, not
		// reported as unknown.
		{"value starting with dashes", []string{"--root", "--weird"}, false},
		{"value flag at end", []string{"--tls", "--root"}, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := checkFlags(tc.args, boolFlags, valueFlags)
			if tc.wantErr && err == nil {
				t.Fatalf("checkFlags(%q) = nil, want error", tc.args)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("checkFlags(%q) = %v, want nil", tc.args, err)
			}
		})
	}
}

// `--allow-control-api` granted an app root-equivalent access to the control
// API. It was removed once its only consumer (bay-ui/bay-admin) was deleted and
// remote deploys moved to SSH — nothing needs inbound control access any more,
// and a privilege path with no users is one nobody reviews.
//
// This pins that the flag is REFUSED rather than ignored. `cmdDeploy`'s parse
// loop is a hand-rolled switch that skips what it does not match, so without
// `checkFlags` the flag would be silently dropped and an operator carrying it
// in a script would believe a grant was still being made.
func TestAllowControlAPIIsRefusedNotIgnored(t *testing.T) {
	err := checkFlags(
		[]string{"--name", "demo", "--allow-control-api"},
		map[string]bool{},
		map[string]bool{"--name": true, "--env": true, "--domain": true,
			"--control-socket": true})
	if err == nil {
		t.Fatal("a removed privilege flag must fail the command, not pass unnoticed")
	}
}
