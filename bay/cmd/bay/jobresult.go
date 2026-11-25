package main

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"sync"

	"github.com/alepha-dev/bay/internal/connector"
)

/*
An agent job's final reply (#Q4288): what the agent answered at the end of
its run, returned to Lore in the job's terminal ack.

Bay keeps the agent's stream as its log, line by line as it happens, and reads
the reply from that same stream as it passes: each adapter says which lines
make its final result. It is read before the log's cap applies, so a run whose
spool was cut at jobLogCap still has its reply.

An agent that ended on an error result sends none: its failure is the ack's
reason, as before. A job that never printed a result line (a crash, a check, a
non-agent job) sends none either, and that is not a failure.
*/

// resultReader reads one run's stream, line by line, for its final reply.
type resultReader interface {
	// Line is one complete line of the agent's stdout, without its newline.
	Line(line []byte)
	// Final answers the reply, whether it was an error result, and whether
	// the stream held a result at all.
	Final() (reply string, isError bool, ok bool)
}

// totalsReader is a resultReader that also reads what the run cost
// (#Q4293), from the same final line.
type totalsReader interface {
	// Totals answers the run's turns, tokens and cost, and whether the
	// stream said any of them.
	Totals() (connector.JobTotals, bool)
}

// maxResultLine is the longest stdout line Bay holds to read a result from;
// a longer one is skipped, as a result that size could not ride an ack.
const maxResultLine = 4 << 20

/*
claudeResult reads Claude Code's stream-json: its run ends on one `result`
event, `{"type":"result","is_error":false,"result":"<the reply>"}`, which is
also the single object `--output-format json` prints. The same event says
what the run cost (#Q4293): `num_turns`, `usage` and `total_cost_usd`.
*/
type claudeResult struct {
	reply   string
	isError bool
	ok      bool
	totals  connector.JobTotals
	counted bool
}

func (r *claudeResult) Line(line []byte) {
	if !bytes.Contains(line, []byte(`"result"`)) {
		return
	}
	var event struct {
		Type     string   `json:"type"`
		IsError  bool     `json:"is_error"`
		Result   string   `json:"result"`
		NumTurns *int     `json:"num_turns"`
		CostUSD  *float64 `json:"total_cost_usd"`
		Usage    *struct {
			InputTokens              *int64 `json:"input_tokens"`
			OutputTokens             *int64 `json:"output_tokens"`
			CacheCreationInputTokens int64  `json:"cache_creation_input_tokens"`
			CacheReadInputTokens     int64  `json:"cache_read_input_tokens"`
		} `json:"usage"`
	}
	if json.Unmarshal(line, &event) != nil || event.Type != "result" {
		return
	}
	r.reply, r.isError, r.ok = event.Result, event.IsError, true
	totals := connector.JobTotals{Turns: event.NumTurns, CostUSD: event.CostUSD}
	if event.Usage != nil {
		if event.Usage.InputTokens != nil {
			// The cache's reads and writes are input too, as the job page
			// counts them.
			in := *event.Usage.InputTokens + event.Usage.CacheCreationInputTokens + event.Usage.CacheReadInputTokens
			totals.InputTokens = &in
		}
		totals.OutputTokens = event.Usage.OutputTokens
	}
	r.totals = totals
	r.counted = totals.Turns != nil || totals.CostUSD != nil || totals.InputTokens != nil || totals.OutputTokens != nil
}

func (r *claudeResult) Final() (string, bool, bool) { return r.reply, r.isError, r.ok }

func (r *claudeResult) Totals() (connector.JobTotals, bool) { return r.totals, r.counted }

/*
geminiResult reads Gemini CLI's stream-json, as its source prints it: the
reply is streamed as `message` events of role `assistant` with `delta: true`,
one per chunk, and the run ends on a `result` event that carries no text,
only `status` (`success` or `error`). The reply is the assistant's text after
its last tool call: a `tool_use` or `tool_result` starts it again, so what the
agent said between its tool calls is not taken for its answer.
*/
type geminiResult struct {
	text    strings.Builder
	isError bool
	ok      bool
}

func (r *geminiResult) Line(line []byte) {
	var event struct {
		Type    string `json:"type"`
		Role    string `json:"role"`
		Content string `json:"content"`
		Status  string `json:"status"`
	}
	if json.Unmarshal(line, &event) != nil {
		return
	}
	switch event.Type {
	case "message":
		if event.Role == "assistant" && r.text.Len() < maxResultLine {
			r.text.WriteString(event.Content)
		}
	case "tool_use", "tool_result":
		r.text.Reset()
	case "result":
		r.ok, r.isError = true, event.Status != "success"
	}
}

func (r *geminiResult) Final() (string, bool, bool) {
	return strings.TrimSpace(r.text.String()), r.isError, r.ok
}

/*
resultScanner is an io.Writer splitting what it is given into lines for a
resultReader. It sits beside the log's writer on the agent's stdout, so it
sees every byte, past the log's cap too.
*/
type resultScanner struct {
	mu      sync.Mutex
	reader  resultReader
	partial []byte
	// skipping drops the rest of a line already past maxResultLine.
	skipping bool
}

func newResultScanner(reader resultReader) *resultScanner {
	return &resultScanner{reader: reader}
}

func (s *resultScanner) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rest := p
	for len(rest) > 0 {
		i := bytes.IndexByte(rest, '\n')
		if i < 0 {
			s.hold(rest)
			break
		}
		s.hold(rest[:i])
		if !s.skipping {
			s.reader.Line(bytes.TrimRight(s.partial, "\r"))
		}
		s.partial, s.skipping = s.partial[:0], false
		rest = rest[i+1:]
	}
	return len(p), nil
}

func (s *resultScanner) hold(b []byte) {
	if s.skipping {
		return
	}
	if len(s.partial)+len(b) > maxResultLine {
		s.partial, s.skipping = s.partial[:0], true
		return
	}
	s.partial = append(s.partial, b...)
}

// Final reads a last line the stream did not end with a newline, then
// answers the reader's result.
func (s *resultScanner) Final() (string, bool, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.partial) > 0 && !s.skipping {
		s.reader.Line(s.partial)
		s.partial = s.partial[:0]
	}
	return s.reader.Final()
}

// Totals answers what the run cost, when its reader reads that (#Q4293).
// Called after Final, which reads the last line.
func (s *resultScanner) Totals() (connector.JobTotals, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if reader, ok := s.reader.(totalsReader); ok {
		return reader.Totals()
	}
	return connector.JobTotals{}, false
}

// teeWriter writes to both, always reporting the whole length: the log's
// writer drops past its cap on purpose, and the scanner never fails.
type teeWriter struct{ a, b io.Writer }

func (t teeWriter) Write(p []byte) (int, error) {
	_, _ = t.a.Write(p)
	_, _ = t.b.Write(p)
	return len(p), nil
}
