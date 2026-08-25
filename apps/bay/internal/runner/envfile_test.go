package runner

import (
	"os"
	"path/filepath"
	"testing"
)

// The values that made the three readers of a .env disagree.
//
// A .env is read by Bay itself (LoadEnvFile) AND handed to systemd as an
// EnvironmentFile, whose grammar is shell-like: it unescapes backslashes and
// honours quotes. Written raw, a JSON secret arrived with its escapes eaten, a
// value ending in a backslash glued the NEXT line onto it, and a value opening
// with a quote swallowed everything up to the next one.
var envRoundTripCases = []struct {
	name  string
	value string
}{
	{"plain", "hello"},
	{"empty", ""},
	{"json secret", `{"type":"service_account","key":"-----BEGIN\nKEY-----"}`},
	{"trailing backslash", `C:\path\`},
	{"leading quote", `"quoted from the start`},
	{"embedded quotes", `say "hello" twice`},
	{"newlines", "line one\nline two\n"},
	{"tab and cr", "a\tb\r"},
	{"spaces at both ends", "  padded  "},
	{"dollar sign", "pa$$word${NOT_EXPANDED}"},
	{"hash", "value # not a comment"},
	{"equals", "key=value=more"},
	{"single quotes", `it's 'quoted'`},
	{"backslash before quote", `ends with \"`},
	{"unicode", "héllo → 世界"},
}

func TestQuoteEnvValueRoundTrip(t *testing.T) {
	for _, tc := range envRoundTripCases {
		t.Run(tc.name, func(t *testing.T) {
			got := UnquoteEnvValue(QuoteEnvValue(tc.value))
			if got != tc.value {
				t.Fatalf("round trip changed the value:\n  wrote %q\n  as    %q\n  read  %q",
					tc.value, QuoteEnvValue(tc.value), got)
			}
		})
	}
}

// The same values through a real file, which is what actually ships: the
// per-value round trip above cannot catch a value that terminates the LINE.
func TestLoadEnvFileRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")

	var content string
	for i, tc := range envRoundTripCases {
		content += keyFor(i) + "=" + QuoteEnvValue(tc.value) + "\n"
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	env, err := LoadEnvFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(env) != len(envRoundTripCases) {
		t.Fatalf("read %d keys, wrote %d - a value ran into the next line",
			len(env), len(envRoundTripCases))
	}
	for i, tc := range envRoundTripCases {
		if got := env[keyFor(i)]; got != tc.value {
			t.Errorf("%s: read %q, wrote %q", tc.name, got, tc.value)
		}
	}
}

// A .env already on a VPS predates the quoting and must keep working.
func TestUnquoteEnvValueAcceptsOlderShapes(t *testing.T) {
	cases := []struct{ in, want string }{
		{`bare`, `bare`},
		{`'single quoted'`, `single quoted`},
		{`"double quoted"`, `double quoted`},
		{``, ``},
		{`"`, `"`},
		{`'`, `'`},
		// A lone unmatched quote is not a quoted value.
		{`"unterminated`, `"unterminated`},
		// Single quotes carry no escapes, the shell rule systemd follows too.
		{`'a\nb'`, `a\nb`},
	}
	for _, tc := range cases {
		if got := UnquoteEnvValue(tc.in); got != tc.want {
			t.Errorf("UnquoteEnvValue(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func keyFor(i int) string {
	return "K" + string(rune('A'+i))
}

// The exact bytes written, for the values where systemd's grammar and a naive
// writer disagree.
//
// The round-trip tests above prove Bay's writer and Bay's reader agree with
// each other, which is necessary and not sufficient: they would also pass if
// both were wrong in the same way, and SYSTEMD is the third reader that cannot
// be asked. There is no systemd in the container lane to parse a real unit
// (the image is plain `golang:`), so the encoding is pinned literally instead
// and checked against systemd.exec(5)'s EnvironmentFile grammar by reading:
// double quotes delimit, `\\` is a backslash, `\"` is a quote, `\n` is a
// newline.
func TestQuoteEnvValueWireForm(t *testing.T) {
	cases := []struct{ value, want string }{
		// Unquoted, this was `KEY=C:\path\` and systemd read the backslash as a
		// line continuation, gluing the NEXT variable onto the value.
		{`C:\path\`, `"C:\\path\\"`},
		// Unquoted, systemd opened a quote here and swallowed everything up to
		// the next one, several variables later.
		{`"quoted from the start`, `"\"quoted from the start"`},
		// The JSON secret: every escape survives as itself.
		{`{"k":"a\nb"}`, `"{\"k\":\"a\\nb\"}"`},
		{"line one\nline two", `"line one\nline two"`},
		{"plain", `"plain"`},
		{"", `""`},
	}
	for _, tc := range cases {
		if got := QuoteEnvValue(tc.value); got != tc.want {
			t.Errorf("QuoteEnvValue(%q) = %s, want %s", tc.value, got, tc.want)
		}
	}
}
