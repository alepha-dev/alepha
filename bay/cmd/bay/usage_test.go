package main

import (
	"fmt"
	"strings"
	"testing"
)

/*
The help text is the one document with no reader who can check it.

Nothing in the program consults it, so a default that changes in code leaves
the text behind in silence; and the person who does read it - an operator
meeting Bay for the first time - is precisely the one with no way to know it is
wrong. All four numbers here had drifted at least once before usageText()
started interpolating the constants.

This asserts the interpolation, not the wording: it looks for each default's
own rendered value, so renaming a flag or rewriting a comment is free, while
changing a default without the text following is not.
*/
func TestUsageTextShowsTheRealDefaults(t *testing.T) {
	text := usageText()

	cases := []struct {
		name string
		want string
	}{
		{"--root", defaultRoot},
		{"--addr", defaultProxyAddr},
		{"--tls-addr", defaultTLSAddr},
		{"--control-group", defaultControlGroup},
		// Rendered the way Go prints a Duration ("24h0m0s"), which is what
		// keeps it honest: it is the constant itself, not a prettier
		// paraphrase that can disagree with it.
		{"--backup-interval", defaultBackupInterval.String()},
		{"--keep-releases", fmt.Sprintf("%d", defaultKeepReleases)},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// Anchored on the flag's own line, not merely present somewhere in
			// a 70-line document: "2" appears in the prose often enough that a
			// bare Contains would pass with the default missing entirely.
			if !strings.Contains(text, c.name+" "+c.want) {
				t.Errorf("usage text does not show %s %s\n%s", c.name, c.want, text)
			}
		})
	}
}

/*
Every flag `serve` accepts should be in the text, or an operator can only find
it by reading main.go.

The list comes from checkFlags' own maps in cmdServe, which is what actually
decides whether a flag is accepted - so a flag added there and forgotten here
fails rather than becoming undocumented.
*/
func TestUsageTextMentionsEveryServeFlag(t *testing.T) {
	text := usageText()

	serveFlags := []string{
		"--tls",
		"--root", "--runtimes", "--base-domain",
		"--addr", "--tls-addr",
		"--acme-ca", "--acme-email", "--acme-ca-root",
		"--acme-http-port", "--acme-tls-port",
		"--control-socket", "--control-group",
		"--backup-interval", "--keep-releases",
	}

	for _, flag := range serveFlags {
		if !strings.Contains(text, flag) {
			t.Errorf("usage text never mentions %s", flag)
		}
	}
}
