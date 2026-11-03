package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/alepha-dev/bay/internal/runner"
)

// defaultLogLines is what `bay logs` asks for when nobody said.
const defaultLogLines = 200

func cmdLogs(args []string) error {
	name, env, err := instanceFromArgs(args)
	if err != nil {
		return errors.New("usage: bay logs <app>[/<env>] [-n 200] [--since 15m] [--grep RE] [--json]")
	}

	lines := defaultLogLines
	asJSON := false
	var since time.Duration
	var grep *regexp.Regexp
	for i, arg := range args {
		switch arg {
		case "--json":
			asJSON = true
		case "-n", "--lines":
			if i >= len(args)-1 {
				return errors.New("-n needs a count")
			}
			if _, err := fmt.Sscanf(args[i+1], "%d", &lines); err != nil || lines <= 0 {
				return fmt.Errorf("parse -n: %q is not a positive integer", args[i+1])
			}
		case "--since":
			if i >= len(args)-1 {
				return errors.New("--since needs a duration, e.g. --since 15m")
			}
			since, err = time.ParseDuration(args[i+1])
			if err != nil {
				return fmt.Errorf("parse --since: %w", err)
			}
		case "--grep":
			if i >= len(args)-1 {
				return errors.New("--grep needs a pattern")
			}
			// A regular expression, not a substring. The reader here is usually
			// an agent over SSH, and `level":"error"|ECONN` in one pass beats
			// three invocations.
			grep, err = regexp.Compile(args[i+1])
			if err != nil {
				return fmt.Errorf("parse --grep: %w", err)
			}
		}
	}

	url := fmt.Sprintf("%s/apps/%s/%s/logs?lines=%d", controlHost, name, env, lines)
	raw, err := call(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	var response logsResponse
	if err := json.Unmarshal([]byte(raw), &response); err != nil {
		return fmt.Errorf("parse control api response: %w", err)
	}
	if err := logsUnavailable(name, env, response); err != nil {
		return err
	}

	kept := filterLogs(response.Lines, since, grep)
	if asJSON {
		encoded, err := json.MarshalIndent(kept, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(encoded))
		return nil
	}
	fmt.Print(renderLogs(kept))
	return nil
}

// logsUnavailable reports why there is nothing to read, or nil when there is.
//
// Three outcomes look identical in the payload — an empty `lines` array — and
// each sends the operator somewhere different:
//
//   - supervised: readable, however quiet.
//   - static: there is no process and never will be. Naming it stops the search
//     before it starts.
//   - neither: this Bay has never started that app, so the question is whether
//     the host or the env is wrong.
func logsUnavailable(name, env string, response logsResponse) error {
	if response.Supervised {
		return nil
	}
	if response.Static {
		return fmt.Errorf(
			"%s/%s is a static site — it is served from disk with no process, so there are no logs; requests to it appear in Bay's own log",
			name, env)
	}
	// Not an empty result: a different fact entirely, and one that usually
	// means the operator is on the wrong host or typed the wrong env.
	return fmt.Errorf("%s/%s is not supervised by this Bay — nothing to read", name, env)
}

// filterLogs applies --since and --grep.
//
// Every entry carries a time, so --since can judge them all: Bay asks Docker for
// timestamps, and Docker stamps each line it stored, whatever the app wrote.
func filterLogs(lines []runner.LogLine, since time.Duration, grep *regexp.Regexp) []runner.LogLine {
	if since == 0 && grep == nil {
		return lines
	}
	cutoff := time.Now().Add(-since)
	kept := make([]runner.LogLine, 0, len(lines))
	for _, line := range lines {
		if grep != nil && !grep.MatchString(line.Raw) {
			continue
		}
		if since > 0 && line.At.Before(cutoff) {
			continue
		}
		kept = append(kept, line)
	}
	return kept
}

// renderLogs prints one line per entry, timestamp and level first when they
// were recoverable and the raw line otherwise.
func renderLogs(lines []runner.LogLine) string {
	var b strings.Builder
	if len(lines) == 0 {
		// Supervised and silent. Said in words, because an empty screen looks
		// identical to a broken command.
		return "no matching log lines\n"
	}
	for _, line := range lines {
		switch {
		case line.At.IsZero() && line.Level == "":
			fmt.Fprintln(&b, line.Raw)
		case line.Text == "":
			fmt.Fprintf(&b, "%s %-5s %s\n", stamp(line.At), line.Level, line.Raw)
		default:
			fmt.Fprintf(&b, "%s %-5s %s\n", stamp(line.At), line.Level, line.Text)
		}
	}
	return b.String()
}

func stamp(t time.Time) string {
	if t.IsZero() {
		return strings.Repeat(" ", len(time.RFC3339))
	}
	return t.Local().Format(time.RFC3339)
}
