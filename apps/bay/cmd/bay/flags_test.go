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
