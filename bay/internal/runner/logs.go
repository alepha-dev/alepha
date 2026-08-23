package runner

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// maxLogLineBytes is the longest single log line the scanners will accept.
//
// One MiB, against bufio's 64 KiB default. An Alepha log entry carrying a stack
// trace goes past 64 KiB regularly, and the default does not truncate it — it
// stops the scan with an error, or splits the entry into two halves that are
// each invalid JSON. Either way the operator loses exactly the line they went
// looking for.
const maxLogLineBytes = 1 << 20

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

// TailFile returns the last n lines of a file.
//
// Read forward into a ring rather than seeking to the end and scanning back.
// Backwards is the obvious implementation and it is wrong here: a reverse byte
// scan lands in the middle of a multi-byte UTF-8 sequence and splits it, which
// turns an accented word in a log message into two replacement characters. The
// file is bounded by rotation, so reading it forward costs a bounded amount of
// work and is always correct.
func TailFile(path string, n int) ([]LogLine, error) {
	if n <= 0 {
		return nil, nil
	}
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		// Not an error. An app that has started and said nothing has no log
		// file, and that is a fact about the app rather than a failure to read.
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()

	ring := make([]string, 0, n)
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64<<10), maxLogLineBytes)
	for scanner.Scan() {
		if len(ring) == n {
			ring = ring[1:]
		}
		ring = append(ring, scanner.Text())
	}
	if err := scanner.Err(); err != nil {
		// Report what was read alongside the failure: a single over-long line
		// should not swallow the hundred good ones before it.
		return parseLines(ring), fmt.Errorf("read %s: %w", path, err)
	}
	return parseLines(ring), nil
}

func parseLines(raw []string) []LogLine {
	out := make([]LogLine, 0, len(raw))
	for _, line := range raw {
		out = append(out, ParseLogLine(line))
	}
	return out
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

// ParseJournal reads `journalctl --output=json` and unwraps it twice.
//
// Twice because there are two envelopes. journald wraps every entry in its own
// JSON object, and the app's line — itself JSON, from Alepha's logger — arrives
// as a string inside that object's MESSAGE field. Stopping after one unwrap
// shows the operator an escaped blob instead of their log.
//
// Kept out of the systemd file, which is linux-only, so the awkward half is
// exercised by `go test` on a laptop rather than only in CI.
func ParseJournal(output []byte) []LogLine {
	lines := strings.Split(string(output), "\n")
	out := make([]LogLine, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var envelope map[string]any
		if err := json.Unmarshal([]byte(line), &envelope); err != nil {
			// journalctl wrote something that is not its own format. Shown as
			// itself rather than dropped — a warning from journalctl on stdout
			// is information, and swallowing it leaves an unexplained gap.
			out = append(out, LogLine{Raw: line})
			continue
		}
		message, ok := envelope["MESSAGE"].(string)
		if !ok {
			// MESSAGE is an array of byte values when the payload was not valid
			// UTF-8. Nothing useful to show, and inventing a decoding would
			// misreport it.
			continue
		}
		entry := ParseLogLine(message)
		if entry.Level == "" {
			entry.Level = priorityLevel(envelope["PRIORITY"])
		}
		if entry.At.IsZero() {
			entry.At = journalTime(envelope["__REALTIME_TIMESTAMP"])
		}
		out = append(out, entry)
	}
	return out
}

// priorityLevel maps a syslog priority to the same words the app's own levels
// use, so a mixed log sorts and greps as one thing.
func priorityLevel(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	switch text {
	case "0", "1", "2":
		return "fatal"
	case "3":
		return "error"
	case "4":
		return "warn"
	case "5", "6":
		return "info"
	case "7":
		return "debug"
	}
	return ""
}

// journalTime reads journald's __REALTIME_TIMESTAMP, which is a string of
// MICROseconds since the epoch — not milliseconds, and not a number.
func journalTime(value any) time.Time {
	text, ok := value.(string)
	if !ok {
		return time.Time{}
	}
	micros, err := strconv.ParseInt(text, 10, 64)
	if err != nil {
		return time.Time{}
	}
	return time.UnixMicro(micros).UTC()
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
