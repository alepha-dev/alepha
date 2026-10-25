package runner

import (
	"fmt"
	"testing"
	"time"
)

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
