package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/connector"
)

// The agent's final reply, read from its stream as it passes (#Q4288).

func TestResultReaders(t *testing.T) {
	t.Run("claude: the result event's text and its error flag", func(t *testing.T) {
		s := newResultScanner(&claudeResult{})
		_, _ = s.Write([]byte(`{"type":"system","subtype":"init"}` + "\n" + `{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}` + "\n"))
		// A line split across writes is read whole.
		_, _ = s.Write([]byte(`{"type":"result","is_err`))
		_, _ = s.Write([]byte(`or":false,"result":"All done: 3 quests."}` + "\n"))
		reply, isError, ok := s.Final()
		if !ok || isError || reply != "All done: 3 quests." {
			t.Fatalf("reply = %q, error %v, ok %v", reply, isError, ok)
		}

		s = newResultScanner(&claudeResult{})
		_, _ = s.Write([]byte(`{"type":"result","is_error":true,"result":"Credit balance is too low"}`))
		if reply, isError, ok := s.Final(); !ok || !isError || reply != "Credit balance is too low" {
			t.Fatalf("an error result without a newline read as %q, %v, %v", reply, isError, ok)
		}
	})

	t.Run("gemini: the assistant's text after its last tool call, ended by a result", func(t *testing.T) {
		s := newResultScanner(&geminiResult{})
		for _, line := range []string{
			`{"type":"init","session_id":"s","model":"gemini-2.5-pro"}`,
			`{"type":"message","role":"user","content":"Triage the inbox."}`,
			`{"type":"message","role":"assistant","content":"Let me look.","delta":true}`,
			`{"type":"tool_use","tool_name":"feedback_list","tool_id":"1","parameters":{}}`,
			`{"type":"tool_result","tool_id":"1","status":"success","output":"[]"}`,
			`{"type":"message","role":"assistant","content":"Nothing ","delta":true}`,
			`{"type":"message","role":"assistant","content":"is pending.","delta":true}`,
			`{"type":"result","status":"success","stats":{"total_tokens":10}}`,
		} {
			_, _ = s.Write([]byte(line + "\n"))
		}
		if reply, isError, ok := s.Final(); !ok || isError || reply != "Nothing is pending." {
			t.Fatalf("reply = %q, error %v, ok %v", reply, isError, ok)
		}

		s = newResultScanner(&geminiResult{})
		_, _ = s.Write([]byte(`{"type":"result","status":"error","error":{"type":"Fatal","message":"quota"}}` + "\n"))
		if _, isError, ok := s.Final(); !ok || !isError {
			t.Fatal("an error result is not read as one")
		}
	})

	t.Run("a stream with no result line has no reply", func(t *testing.T) {
		s := newResultScanner(&claudeResult{})
		_, _ = s.Write([]byte("not json\n{\"type\":\"assistant\"}\n"))
		if _, _, ok := s.Final(); ok {
			t.Fatal("a reply was read from a stream that printed none")
		}
	})

	t.Run("a reply past the ack's bound is cut, and says so", func(t *testing.T) {
		long := strings.Repeat("é", connector.MaxAckResult)
		cut, truncated := connector.CutResult(long)
		if !truncated || len(cut) > connector.MaxAckResult || !strings.HasPrefix(long, cut) {
			t.Fatalf("cut to %d bytes, truncated %v", len(cut), truncated)
		}
		if same, truncated := connector.CutResult("short"); same != "short" || truncated {
			t.Fatal("a short reply was cut")
		}
	})
}

func TestJobRunReply(t *testing.T) {
	t.Run("the terminal ack carries the reply, and the log still streams each line", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "claude", `#!/bin/sh
[ "$1" = auth ] && exit 0
echo '{"type":"system","subtype":"init"}'
echo '{"type":"result","is_error":false,"result":"Triaged 2 items."}'
`)
		last := w.run("job-reply", w.agentSpec(nil)).last()
		if last.Status != "done" || last.Result != "Triaged 2 items." || last.ResultTruncated {
			t.Fatalf("ack = %+v", last)
		}
		if !strings.Contains(w.frames.text("stdout"), `"type":"system"`) {
			t.Fatalf("the log lost its stream: %q", w.frames.text("stdout"))
		}
		// A redelivered ack says it again.
		again := w.run("job-reply", w.agentSpec(nil)).last()
		if again.Result != "Triaged 2 items." {
			t.Fatalf("the re-ack lost the reply: %+v", again)
		}
	})

	t.Run("a spool cut at the log's cap still has its reply", func(t *testing.T) {
		w := newJobWorld(t)
		// Past jobLogCap of output, then the result line.
		w.stub(t, "claude", `#!/bin/sh
[ "$1" = auth ] && exit 0
head -c 9000000 /dev/zero | tr '\0' 'x'
echo
echo '{"type":"result","is_error":false,"result":"Done despite the noise."}'
`)
		last := w.run("job-big", w.agentSpec(nil)).last()
		if last.Status != "done" || last.Result != "Done despite the noise." {
			t.Fatalf("ack = %+v", last)
		}
	})

	t.Run("an error result is no reply: its words are the failure's reason", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "claude", `#!/bin/sh
[ "$1" = auth ] && exit 0
echo '{"type":"result","is_error":true,"result":"Credit balance is too low"}'
exit 1
`)
		last := w.run("job-error", w.agentSpec(nil)).last()
		if last.Status != "failed" || last.Result != "" || !strings.Contains(last.Reason, "Credit balance is too low") {
			t.Fatalf("ack = %+v", last)
		}
	})

	t.Run("a job that printed no result line succeeds with no reply", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "claude", "#!/bin/sh\n[ \"$1\" = auth ] && exit 0\necho hello\n")
		last := w.run("job-none", w.agentSpec(nil)).last()
		if last.Status != "done" || last.Result != "" {
			t.Fatalf("ack = %+v", last)
		}
	})
}

// What an agent run cost, read from its final result line (#Q4293).
func TestResultTotals(t *testing.T) {
	t.Run("claude: turns, tokens with the cache counted as input, and cost", func(t *testing.T) {
		s := newResultScanner(&claudeResult{})
		_, _ = s.Write([]byte(`{"type":"result","is_error":false,"result":"Done.","num_turns":7,"total_cost_usd":0.4213,"usage":{"input_tokens":120,"cache_creation_input_tokens":3000,"cache_read_input_tokens":45000,"output_tokens":2100}}` + "\n"))
		s.Final()
		totals, ok := s.Totals()
		if !ok {
			t.Fatal("no totals read from a result line that has them")
		}
		if totals.Turns == nil || *totals.Turns != 7 {
			t.Fatalf("turns = %v", totals.Turns)
		}
		if totals.InputTokens == nil || *totals.InputTokens != 48120 {
			t.Fatalf("input tokens = %v, want the cache's reads and writes counted", totals.InputTokens)
		}
		if totals.OutputTokens == nil || *totals.OutputTokens != 2100 {
			t.Fatalf("output tokens = %v", totals.OutputTokens)
		}
		if totals.CostUSD == nil || *totals.CostUSD != 0.4213 {
			t.Fatalf("cost = %v", totals.CostUSD)
		}
	})

	t.Run("an error result still says what it cost", func(t *testing.T) {
		s := newResultScanner(&claudeResult{})
		_, _ = s.Write([]byte(`{"type":"result","is_error":true,"subtype":"error_max_turns","num_turns":30,"total_cost_usd":1.5}`))
		s.Final()
		if totals, ok := s.Totals(); !ok || *totals.Turns != 30 || *totals.CostUSD != 1.5 || totals.InputTokens != nil {
			t.Fatalf("totals = %+v, %v", totals, ok)
		}
	})

	t.Run("no totals from a result line without them, nor from a reader that has none", func(t *testing.T) {
		s := newResultScanner(&claudeResult{})
		_, _ = s.Write([]byte(`{"type":"result","is_error":false,"result":"ok"}` + "\n"))
		s.Final()
		if _, ok := s.Totals(); ok {
			t.Fatal("totals read from a line that has none")
		}
		g := newResultScanner(&geminiResult{})
		_, _ = g.Write([]byte(`{"type":"result","status":"success"}` + "\n"))
		g.Final()
		if _, ok := g.Totals(); ok {
			t.Fatal("totals read from a reader that reads none")
		}
	})

	t.Run("the ack carries them, and an outcome keeps them for a re-ack", func(t *testing.T) {
		turns, cost := 3, 0.02
		o, err := connector.OpenOutcomes(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		out, err := o.Finish("c1", "done", "", "", connector.Extra{Job: true, Totals: &connector.JobTotals{Turns: &turns, CostUSD: &cost}}, time.Now())
		if err != nil {
			t.Fatal(err)
		}
		if out.Totals == nil || *out.Totals.Turns != 3 {
			t.Fatalf("outcome totals = %+v", out.Totals)
		}
		ack := connector.NewAck("c1", "done", "", "")
		ack.Totals = out.Totals
		raw, _ := json.Marshal(ack)
		if !strings.Contains(string(raw), `"totals":{"turns":3,"costUsd":0.02}`) {
			t.Fatalf("ack = %s", raw)
		}
	})
}
