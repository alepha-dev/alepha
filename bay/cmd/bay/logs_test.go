package main

import (
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/runner"
)

func TestFilterLogs(t *testing.T) {
	now := time.Now()
	lines := []runner.LogLine{
		{At: now.Add(-2 * time.Hour), Raw: `{"msg":"old"}`, Text: "old"},
		{At: now.Add(-1 * time.Minute), Raw: `{"msg":"recent"}`, Text: "recent"},
		{At: now.Add(-2 * time.Minute), Raw: "plain stdout"},
		{At: now.Add(-30 * time.Second), Raw: `{"msg":"ECONNREFUSED"}`, Text: "ECONNREFUSED"},
	}

	t.Run("no filters returns everything untouched", func(t *testing.T) {
		got := filterLogs(lines, 0, nil)
		if len(got) != 4 {
			t.Fatalf("want all 4, got %d", len(got))
		}
	})

	t.Run("since drops older entries", func(t *testing.T) {
		got := filterLogs(lines, 15*time.Minute, nil)
		for _, line := range got {
			if line.Text == "old" {
				t.Fatal("the two-hour-old entry should have been dropped")
			}
		}
	})

	t.Run("grep matches the raw line, not just the message", func(t *testing.T) {
		// The raw line is where the level, the fields and the stack live.
		got := filterLogs(lines, 0, regexp.MustCompile(`ECONN`))
		if len(got) != 1 || got[0].Text != "ECONNREFUSED" {
			t.Fatalf("want the one match, got %+v", got)
		}
	})

	t.Run("grep is a regular expression", func(t *testing.T) {
		got := filterLogs(lines, 0, regexp.MustCompile(`old|recent`))
		if len(got) != 2 {
			t.Fatalf("want 2 alternation matches, got %d", len(got))
		}
	})
}

func TestRenderLogs(t *testing.T) {
	t.Run("says so when nothing matched", func(t *testing.T) {
		// An empty screen looks identical to a broken command.
		got := renderLogs(nil)
		if !strings.Contains(got, "no matching log lines") {
			t.Fatalf("want an explicit message, got %q", got)
		}
	})

	t.Run("prints an unstructured line as itself", func(t *testing.T) {
		got := renderLogs([]runner.LogLine{{Raw: "hello"}})
		if strings.TrimSpace(got) != "hello" {
			t.Fatalf("want the bare line, got %q", got)
		}
	})

	t.Run("prints the parsed message when there is one", func(t *testing.T) {
		line := runner.LogLine{
			At:    time.Date(2026, 8, 3, 10, 0, 0, 0, time.UTC),
			Level: "error", Text: "boom", Raw: `{"level":50,"msg":"boom"}`,
		}
		got := renderLogs([]runner.LogLine{line})
		if !strings.Contains(got, "error") || !strings.Contains(got, "boom") {
			t.Fatalf("want level and message, got %q", got)
		}
	})
}

func TestLogsUnavailable(t *testing.T) {
	t.Run("a supervised app is readable", func(t *testing.T) {
		if err := logsUnavailable("lore", "production", logsResponse{Supervised: true}); err != nil {
			t.Fatalf("want readable, got: %v", err)
		}
	})

	t.Run("an unsupervised app sends the operator to check the host", func(t *testing.T) {
		err := logsUnavailable("lore", "production", logsResponse{})
		if err == nil {
			t.Fatal("want an error")
		}
		if !strings.Contains(err.Error(), "not supervised") {
			t.Fatalf("want the host question raised, got %q", err)
		}
	})

	t.Run("a static site says so instead", func(t *testing.T) {
		// The third case. Both of the above are empty results, and so is this —
		// but "not supervised by this Bay" sends someone to check whether they
		// are on the right machine, when the truth is that this site has no
		// process and never will. They would go looking for hours.
		err := logsUnavailable("docs", "production", logsResponse{Static: true})
		if err == nil {
			t.Fatal("want an error")
		}
		if strings.Contains(err.Error(), "not supervised") {
			t.Fatalf("a static site is not a missing app, got %q", err)
		}
		if !strings.Contains(err.Error(), "static") {
			t.Fatalf("want the reason named, got %q", err)
		}
	})
}
