package main

import (
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/alepha/bay/internal/runner"
)

func TestFilterLogs(t *testing.T) {
	now := time.Now()
	lines := []runner.LogLine{
		{At: now.Add(-2 * time.Hour), Raw: `{"msg":"old"}`, Text: "old"},
		{At: now.Add(-1 * time.Minute), Raw: `{"msg":"recent"}`, Text: "recent"},
		{Raw: "plain stdout, no timestamp"},
		{At: now.Add(-30 * time.Second), Raw: `{"msg":"ECONNREFUSED"}`, Text: "ECONNREFUSED"},
	}

	t.Run("no filters returns everything untouched", func(t *testing.T) {
		got, undated := filterLogs(lines, 0, nil)
		if len(got) != 4 || undated != 0 {
			t.Fatalf("want all 4, got %d (%d undated)", len(got), undated)
		}
	})

	t.Run("since drops older entries", func(t *testing.T) {
		got, _ := filterLogs(lines, 15*time.Minute, nil)
		for _, line := range got {
			if line.Text == "old" {
				t.Fatal("the two-hour-old entry should have been dropped")
			}
		}
	})

	t.Run("since KEEPS undated entries and counts them", func(t *testing.T) {
		// An app writing plain text to stdout produces no timestamps at all.
		// Hiding exactly those lines would delete the console.log someone just
		// added — the one line they are looking for.
		got, undated := filterLogs(lines, 15*time.Minute, nil)
		if undated != 1 {
			t.Fatalf("want 1 undated line counted, got %d", undated)
		}
		found := false
		for _, line := range got {
			if line.Raw == "plain stdout, no timestamp" {
				found = true
			}
		}
		if !found {
			t.Fatal("the undated line must be kept")
		}
	})

	t.Run("grep matches the raw line, not just the message", func(t *testing.T) {
		// The raw line is where the level, the fields and the stack live.
		got, _ := filterLogs(lines, 0, regexp.MustCompile(`ECONN`))
		if len(got) != 1 || got[0].Text != "ECONNREFUSED" {
			t.Fatalf("want the one match, got %+v", got)
		}
	})

	t.Run("grep is a regular expression", func(t *testing.T) {
		got, _ := filterLogs(lines, 0, regexp.MustCompile(`old|recent`))
		if len(got) != 2 {
			t.Fatalf("want 2 alternation matches, got %d", len(got))
		}
	})
}

func TestRenderLogs(t *testing.T) {
	t.Run("says so when nothing matched", func(t *testing.T) {
		// An empty screen looks identical to a broken command.
		got := renderLogs(nil, 0, 0)
		if !strings.Contains(got, "no matching log lines") {
			t.Fatalf("want an explicit message, got %q", got)
		}
	})

	t.Run("prints an unstructured line as itself", func(t *testing.T) {
		got := renderLogs([]runner.LogLine{{Raw: "hello"}}, 0, 0)
		if strings.TrimSpace(got) != "hello" {
			t.Fatalf("want the bare line, got %q", got)
		}
	})

	t.Run("prints the parsed message when there is one", func(t *testing.T) {
		line := runner.LogLine{
			At:    time.Date(2026, 8, 3, 10, 0, 0, 0, time.UTC),
			Level: "error", Text: "boom", Raw: `{"level":50,"msg":"boom"}`,
		}
		got := renderLogs([]runner.LogLine{line}, 0, 0)
		if !strings.Contains(got, "error") || !strings.Contains(got, "boom") {
			t.Fatalf("want level and message, got %q", got)
		}
	})

	t.Run("declares the lines --since could not judge", func(t *testing.T) {
		// A reader who thinks the filter applied to these will draw the wrong
		// conclusion from what is on screen.
		got := renderLogs([]runner.LogLine{{Raw: "x"}}, 3, time.Minute)
		if !strings.Contains(got, "3 line(s) carried no timestamp") {
			t.Fatalf("want the caveat spelled out, got %q", got)
		}
	})

	t.Run("stays quiet about undated lines when --since was not used", func(t *testing.T) {
		got := renderLogs([]runner.LogLine{{Raw: "x"}}, 3, 0)
		if strings.Contains(got, "carried no timestamp") {
			t.Fatalf("the caveat is only meaningful with --since, got %q", got)
		}
	})
}
