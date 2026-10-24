package runner

import (
	"encoding/json"
	"strings"
	"time"
)

// LogLine is one entry, with whatever structure could be recovered from it.
//
// Raw is always populated and the parsed fields never replace it. An app is free
// to write anything to stdout, and a viewer that could only show lines it
// understood would hide the `console.log` someone added ten minutes ago to debug
// the very thing being investigated.
type LogLine struct {
	// At is the entry's own timestamp when it carried one, or the journal's.
	At time.Time `json:"at,omitzero"`
	// Level is normalised to lowercase text: "info", "error". Empty when the
	// line declared none.
	Level string `json:"level,omitempty"`
	// Text is the message alone, once the envelope is peeled off.
	Text string `json:"text,omitempty"`
	// Raw is the line exactly as it was written.
	Raw string `json:"raw"`
}

// ParseLogLine recovers structure from one line, best effort.
//
// Never fails. A line that is not JSON, or is JSON of a shape nobody here
// recognises, comes back as itself.
func ParseLogLine(raw string) LogLine {
	entry := LogLine{Raw: raw}
	trimmed := strings.TrimSpace(raw)
	if !strings.HasPrefix(trimmed, "{") {
		return entry
	}
	var fields map[string]any
	if err := json.Unmarshal([]byte(trimmed), &fields); err != nil {
		return entry
	}
	entry.Level = levelOf(fields)
	entry.Text = firstString(fields, "msg", "message")
	entry.At = timeOf(fields)
	return entry
}

// levelOf normalises the several shapes a level arrives in.
//
// Numeric levels are pino's, which Alepha's logger inherits. Left as a number
// they would sort correctly and read as nothing: nobody scanning a log knows
// that 50 is an error.
func levelOf(fields map[string]any) string {
	switch value := fields["level"].(type) {
	case string:
		return strings.ToLower(value)
	case float64:
		switch {
		case value >= 60:
			return "fatal"
		case value >= 50:
			return "error"
		case value >= 40:
			return "warn"
		case value >= 30:
			return "info"
		case value >= 20:
			return "debug"
		default:
			return "trace"
		}
	}
	return ""
}

func firstString(fields map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := fields[key].(string); ok && value != "" {
			return value
		}
	}
	return ""
}

// timeOf reads the entry's own timestamp, in either of the two shapes a JSON
// logger writes it: epoch milliseconds, or RFC3339.
func timeOf(fields map[string]any) time.Time {
	for _, key := range []string{"time", "timestamp", "at"} {
		switch value := fields[key].(type) {
		case float64:
			// Milliseconds, which is what pino writes. Seconds would put every
			// log entry in 1970 and make --since useless in a way that looks
			// like the flag is broken.
			return time.UnixMilli(int64(value)).UTC()
		case string:
			if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
				return parsed.UTC()
			}
		}
	}
	return time.Time{}
}
