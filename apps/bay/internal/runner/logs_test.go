package runner

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestTailFile(t *testing.T) {
	write := func(t *testing.T, content string) string {
		t.Helper()
		path := filepath.Join(t.TempDir(), "app.log")
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		return path
	}

	t.Run("returns the last n lines in order", func(t *testing.T) {
		var b strings.Builder
		for i := 1; i <= 10; i++ {
			fmt.Fprintf(&b, "line %d\n", i)
		}
		got, err := TailFile(write(t, b.String()), 3)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 3 {
			t.Fatalf("want 3 lines, got %d", len(got))
		}
		if got[0].Raw != "line 8" || got[2].Raw != "line 10" {
			t.Fatalf("want lines 8..10 in order, got %q..%q", got[0].Raw, got[2].Raw)
		}
	})

	t.Run("an absent file is not an error", func(t *testing.T) {
		// An app that started and said nothing has no log file. That is a fact
		// about the app, not a failure to read.
		got, err := TailFile(filepath.Join(t.TempDir(), "nope.log"), 10)
		if err != nil || got != nil {
			t.Fatalf("want no lines and no error, got %v %v", got, err)
		}
	})

	t.Run("asking for nothing returns nothing", func(t *testing.T) {
		got, err := TailFile(write(t, "a\nb\n"), 0)
		if err != nil || got != nil {
			t.Fatalf("want nothing, got %v %v", got, err)
		}
	})

	t.Run("keeps a multi-byte character intact", func(t *testing.T) {
		// The reason the scan runs forward. A reverse byte scan lands inside a
		// UTF-8 sequence and splits it, turning an accent into two replacement
		// characters.
		got, err := TailFile(write(t, "Bjørn started\nZoë is ready\n"), 1)
		if err != nil {
			t.Fatal(err)
		}
		if got[0].Raw != "Zoë is ready" {
			t.Fatalf("multi-byte characters were mangled: %q", got[0].Raw)
		}
	})

	t.Run("reads a line longer than bufio's default", func(t *testing.T) {
		// An Alepha entry with a stack trace goes past 64 KiB regularly, and the
		// default does not truncate — it aborts the scan.
		long := strings.Repeat("x", 200<<10)
		got, err := TailFile(write(t, "first\n"+long+"\n"), 2)
		if err != nil {
			t.Fatalf("a long line must not abort the scan: %v", err)
		}
		if len(got) != 2 || len(got[1].Raw) != len(long) {
			t.Fatalf("the long line was lost or truncated: %d lines, last is %d bytes", len(got), len(got[1].Raw))
		}
	})
}

func TestParseLogLine(t *testing.T) {
	t.Run("plain text comes back as itself", func(t *testing.T) {
		// A viewer that only showed lines it understood would hide the
		// console.log someone added ten minutes ago to debug this very thing.
		got := ParseLogLine("just some text")
		if got.Raw != "just some text" || got.Text != "" || got.Level != "" {
			t.Fatalf("want the raw line untouched, got %+v", got)
		}
	})

	t.Run("reads a JSON entry", func(t *testing.T) {
		got := ParseLogLine(`{"level":"error","msg":"boom","time":"2026-08-03T10:00:00Z"}`)
		if got.Level != "error" || got.Text != "boom" {
			t.Fatalf("want error/boom, got %+v", got)
		}
		if !got.At.Equal(time.Date(2026, 8, 3, 10, 0, 0, 0, time.UTC)) {
			t.Fatalf("want the entry's own time, got %v", got.At)
		}
	})

	t.Run("translates a numeric level", func(t *testing.T) {
		// Left as a number it reads as nothing: nobody scanning a log knows
		// that 50 is an error.
		for level, want := range map[float64]string{60: "fatal", 50: "error", 40: "warn", 30: "info", 20: "debug", 10: "trace"} {
			got := ParseLogLine(fmt.Sprintf(`{"level":%v,"msg":"x"}`, level))
			if got.Level != want {
				t.Fatalf("level %v: want %q, got %q", level, want, got.Level)
			}
		}
	})

	t.Run("reads epoch milliseconds", func(t *testing.T) {
		// Seconds would put every entry in 1970 and make --since look broken.
		got := ParseLogLine(`{"msg":"x","time":1785000000000}`)
		if got.At.Year() != 2026 {
			t.Fatalf("want a 2026 timestamp, got %v", got.At)
		}
	})

	t.Run("malformed JSON keeps the raw line", func(t *testing.T) {
		got := ParseLogLine(`{"level":"error", oops`)
		if got.Raw != `{"level":"error", oops` || got.Level != "" {
			t.Fatalf("want the raw line, got %+v", got)
		}
	})
}

func TestParseJournal(t *testing.T) {
	t.Run("unwraps both envelopes", func(t *testing.T) {
		// journald wraps the entry, and the app's own JSON arrives as a string
		// inside MESSAGE. Stopping after one unwrap shows an escaped blob.
		output := []byte(`{"__REALTIME_TIMESTAMP":"1785000000000000","PRIORITY":"6","MESSAGE":"{\"level\":50,\"msg\":\"boom\"}"}`)
		got := ParseJournal(output)
		if len(got) != 1 {
			t.Fatalf("want 1 entry, got %d", len(got))
		}
		if got[0].Text != "boom" {
			t.Fatalf("the inner envelope was not opened: %+v", got[0])
		}
		if got[0].Level != "error" {
			t.Fatalf("the app's own level must win over PRIORITY, got %q", got[0].Level)
		}
	})

	t.Run("falls back to PRIORITY when the app declared no level", func(t *testing.T) {
		output := []byte(`{"PRIORITY":"3","MESSAGE":"segfault"}`)
		got := ParseJournal(output)
		if got[0].Level != "error" {
			t.Fatalf("want error from PRIORITY=3, got %q", got[0].Level)
		}
	})

	t.Run("reads the journal timestamp as microseconds", func(t *testing.T) {
		// __REALTIME_TIMESTAMP is a STRING of microseconds. Read as millis it
		// lands fifty years early.
		output := []byte(`{"__REALTIME_TIMESTAMP":"1785000000000000","MESSAGE":"x"}`)
		got := ParseJournal(output)
		if got[0].At.Year() != 2026 {
			t.Fatalf("want 2026, got %v", got[0].At)
		}
	})

	t.Run("keeps a line that is not journal JSON", func(t *testing.T) {
		// A warning from journalctl on stdout is information; swallowing it
		// leaves an unexplained gap.
		got := ParseJournal([]byte("-- No entries --\n"))
		if len(got) != 1 || got[0].Raw != "-- No entries --" {
			t.Fatalf("want the raw line kept, got %+v", got)
		}
	})

	t.Run("skips a binary MESSAGE", func(t *testing.T) {
		got := ParseJournal([]byte(`{"MESSAGE":[104,105]}`))
		if len(got) != 0 {
			t.Fatalf("want the entry skipped rather than invented, got %+v", got)
		}
	})

	t.Run("ignores blank lines", func(t *testing.T) {
		got := ParseJournal([]byte("\n\n"))
		if len(got) != 0 {
			t.Fatalf("want nothing, got %d", len(got))
		}
	})
}

func TestChildLogsReportsSupervision(t *testing.T) {
	// The bool is the distinction an empty slice cannot carry: "this Bay never
	// started that app" sends an operator somewhere else entirely.
	child := NewChild()
	if _, supervised, err := child.Logs("never/started", 10); supervised || err != nil {
		t.Fatalf("want supervised=false and no error, got %v %v", supervised, err)
	}
}
