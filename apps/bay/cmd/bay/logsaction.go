package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"time"

	"github.com/alepha/bay/internal/connector"
	"github.com/alepha/bay/internal/runner"
)

/*
logsResult is what a `logs` command answers with.

⚠️ Three flags, not one, because "no lines" sends an operator to three
different places: an app this Bay has never started, a static site that will
never have a process, and a supervised app that is simply quiet. That is the
distinction `logsResponse` already draws for the control API, kept here.

`undated` is what `filterLogs` counts: lines with no timestamp, kept by a
`--since` window they cannot be judged against. `truncated` is what was
dropped to fit the sink's cap.
*/
type logsResult struct {
	Supervised bool             `json:"supervised"`
	Static     bool             `json:"static,omitempty"`
	Undated    int              `json:"undated,omitempty"`
	Truncated  int              `json:"truncated,omitempty"`
	Lines      []runner.LogLine `json:"lines"`
}

/*
logs answers a bounded tail of one instance's journal.

The filtering is `filterLogs`, the same function `bay logs` uses, called and
not reimplemented: two filters eventually disagree about what `--since` means
for an undated line, and the disagreement is invisible.

⚠️ The order is: ack `running` (done by the caller), upload, ack `done`. The
sink accepts a result only while the command is `sent` or `running`, so an ack
of `done` sent first would turn the upload into a 404 and leave the owner a
finished command with nothing to read.

An upload that fails is a `failed` ack carrying the sink's answer, so the row
says why there is nothing to read rather than saying nothing.
*/
func (a *actions) logs(ctx context.Context, cmd connector.Command) (status, step, reason string) {
	key := cmd.App + "/" + cmd.Environment
	app, known := a.s.store.Get(key)
	if !known {
		return "failed", "", "unknown instance " + key + " on this bay"
	}

	ask := cmd.Logs
	if ask == nil {
		return "failed", "", "a logs command must say how many lines it wants"
	}
	lines := min(max(ask.Lines, 1), maxLogRequest)

	var pattern *regexp.Regexp
	if ask.Grep != "" {
		// Go's regexp is RE2: no backtracking, so a hostile pattern costs
		// time proportional to the tail and nothing worse. An invalid one is
		// the caller's mistake and is reported as such.
		compiled, err := regexp.Compile(ask.Grep)
		if err != nil {
			return "failed", "", "the grep pattern does not compile: " + err.Error()
		}
		pattern = compiled
	}

	entries, supervised, err := a.s.runner.Logs(key, lines)
	if err != nil {
		return "failed", "reading", err.Error()
	}
	kept, undated := filterLogs(entries, time.Duration(ask.SinceSeconds)*time.Second, pattern)

	result := logsResult{
		Supervised: supervised,
		Static:     app.Static,
		Undated:    undated,
		Lines:      kept,
	}
	if result.Lines == nil {
		// A list, never null: an empty tail is a fact, and the three flags
		// above are what explain it.
		result.Lines = []runner.LogLine{}
	}

	body, err := encodeLogsResult(result)
	if err != nil {
		return "failed", "encoding", err.Error()
	}

	cfg, ok, err := connector.NewStore(a.s.root).Load()
	if err != nil || !ok {
		return "failed", "uploading", "no connector is configured on this bay, so there is nowhere to send the answer"
	}
	client := &http.Client{Timeout: connector.FetchTimeout}
	if err := connector.PushResult(ctx, client, cfg, cmd.ID, body); err != nil {
		return "failed", "uploading", err.Error()
	}
	return "done", "", fmt.Sprintf("%d line(s) uploaded", len(result.Lines))
}

/*
encodeLogsResult serialises the answer, dropping the OLDEST lines until it
fits the sink's cap.

The oldest, because the newest are the ones somebody is looking for: a tail cut
at the wrong end answers a question nobody asked. What was dropped is counted
rather than implied, since a tail silently missing its beginning is one people
draw the wrong conclusion from.
*/
func encodeLogsResult(result logsResult) ([]byte, error) {
	for {
		body, err := json.Marshal(result)
		if err != nil {
			return nil, err
		}
		if len(body) <= connector.MaxResultBytes || len(result.Lines) == 0 {
			return body, nil
		}
		// Halve the excess rather than shave one line at a time: a 10 MB tail
		// would otherwise re-encode thousands of times.
		drop := max(1, len(result.Lines)/2)
		result.Truncated += drop
		result.Lines = result.Lines[drop:]
	}
}
