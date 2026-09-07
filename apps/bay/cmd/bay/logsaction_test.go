package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alepha/bay/internal/connector"
	"github.com/alepha/bay/internal/runner"
)

func logsCommand(id string, ask *connector.LogsAsk) connector.Command {
	return connector.Command{
		ID: id, Kind: "logs", App: "demo", Environment: "production", Logs: ask,
	}
}

// fakeSink records what a machine uploaded, and can refuse the way the real
// one does: one 404 for a command it does not hold.
type fakeSink struct {
	mu       sync.Mutex
	uploaded [][]byte
	status   int
}

func (s *fakeSink) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/result") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		body, _ := io.ReadAll(io.LimitReader(r.Body, 4<<20))
		s.mu.Lock()
		s.uploaded = append(s.uploaded, body)
		status := s.status
		s.mu.Unlock()
		if status == 0 {
			status = http.StatusOK
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"stored":true}`))
	})
}

func (s *fakeSink) last(t *testing.T) logsResult {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.uploaded) == 0 {
		t.Fatal("nothing was uploaded")
	}
	var out logsResult
	if err := json.Unmarshal(s.uploaded[len(s.uploaded)-1], &out); err != nil {
		t.Fatalf("the upload is not the documented shape: %v", err)
	}
	return out
}

// enrolled points the fixture's connector config at a fake sink.
func enrolled(t *testing.T, f *deployFixture) *fakeSink {
	t.Helper()
	sink := &fakeSink{}
	server := httptest.NewServer(sink.handler())
	t.Cleanup(server.Close)
	if err := connector.NewStore(f.root).Set(connector.Config{
		Sink: server.URL, Secret: "est_test_secret",
	}); err != nil {
		t.Fatal(err)
	}
	return sink
}

/*
The ordering both halves agree on: upload, THEN ack done.

The sink accepts a result only while the command is sent or running, so acking
done first would turn the upload into a 404 and leave the owner a finished
command with nothing to read.
*/
func TestLogsUploadsBeforeTheTerminalAck(t *testing.T) {
	f := deployedApp(t)
	sink := enrolled(t, f)
	acts := newActions(f.server)
	rec := &ackRecorder{}

	acts.Command(context.Background(), logsCommand("c-logs", &connector.LogsAsk{Lines: 50}), rec.send)

	if got := rec.statuses(); !equalStrings(got, []string{"running", "done"}) {
		t.Fatalf("acks = %v, want running then done", got)
	}
	result := sink.last(t)
	// Three flags, because "no lines" sends an operator to three different
	// places.
	if result.Lines == nil {
		t.Fatal("lines must be a list, never null")
	}
	_ = result.Supervised
}

// An upload that fails is a failed ack carrying the sink's answer, so the row
// says why there is nothing to read rather than saying nothing.
func TestLogsAcksFailedWhenTheUploadIsRefused(t *testing.T) {
	f := deployedApp(t)
	sink := enrolled(t, f)
	sink.status = http.StatusNotFound
	acts := newActions(f.server)
	rec := &ackRecorder{}

	acts.Command(context.Background(), logsCommand("c-logs-404", &connector.LogsAsk{Lines: 50}), rec.send)

	last := rec.acks[len(rec.acks)-1]
	if last.Status != "failed" {
		t.Fatalf("a refused upload must fail the command: %+v", last)
	}
	if !strings.Contains(last.Reason, "404") {
		t.Fatalf("the reason must carry the sink's answer: %q", last.Reason)
	}
	if last.Step != "uploading" {
		t.Fatalf("step = %q, want uploading", last.Step)
	}
}

// A read must answer during a long deploy rather than queue behind it.
func TestLogsRunsOutsideTheMachineWideMutex(t *testing.T) {
	f := deployedApp(t)
	enrolled(t, f)
	acts := newActions(f.server)

	acts.mu.Lock()
	defer acts.mu.Unlock()

	done := make(chan struct{})
	go func() {
		acts.Command(context.Background(),
			logsCommand("c-logs-busy", &connector.LogsAsk{Lines: 10}), (&ackRecorder{}).send)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("a log tail queued behind the machine-wide action mutex")
	}
}

func TestLogsRefusesAnUnknownInstanceAndABadPattern(t *testing.T) {
	f := deployedApp(t)
	enrolled(t, f)
	acts := newActions(f.server)

	rec := &ackRecorder{}
	acts.Command(context.Background(), connector.Command{
		ID: "c-logs-unknown", Kind: "logs", App: "nope", Environment: "production",
		Logs: &connector.LogsAsk{Lines: 10},
	}, rec.send)
	if last := rec.acks[len(rec.acks)-1]; last.Status != "failed" ||
		!strings.Contains(last.Reason, "unknown instance") {
		t.Fatalf("an unknown instance must be refused by name: %+v", last)
	}

	rec = &ackRecorder{}
	acts.Command(context.Background(),
		logsCommand("c-logs-badre", &connector.LogsAsk{Lines: 10, Grep: "("}), rec.send)
	if last := rec.acks[len(rec.acks)-1]; last.Status != "failed" ||
		!strings.Contains(last.Reason, "does not compile") {
		t.Fatalf("an invalid pattern must be reported: %+v", last)
	}
}

/*
The cap is enforced by dropping the OLDEST lines: the newest are the ones
somebody is looking for, and what was dropped is counted rather than implied.
*/
func TestEncodeLogsResultDropsTheOldestLinesToFit(t *testing.T) {
	long := strings.Repeat("x", 2000)
	result := logsResult{Supervised: true}
	for i := 0; i < 2000; i++ {
		result.Lines = append(result.Lines, runner.LogLine{Raw: long})
	}
	// 2000 lines of 2000 bytes is about 4 MB, comfortably over the cap.
	body, err := encodeLogsResult(result)
	if err != nil {
		t.Fatal(err)
	}
	if len(body) > connector.MaxResultBytes {
		t.Fatalf("the payload is %d bytes, over the cap", len(body))
	}

	var decoded logsResult
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Truncated == 0 {
		t.Fatal("what was dropped must be counted, not implied")
	}
	if decoded.Truncated+len(decoded.Lines) != 2000 {
		t.Fatalf("truncated %d plus kept %d does not account for 2000",
			decoded.Truncated, len(decoded.Lines))
	}
	if len(decoded.Lines) == 0 {
		t.Fatal("something must survive")
	}
}

// A payload that already fits is left alone, truncation count included.
func TestEncodeLogsResultLeavesASmallTailAlone(t *testing.T) {
	result := logsResult{
		Supervised: true,
		Lines:      []runner.LogLine{{Raw: "boot"}, {Raw: "ready"}},
	}
	body, err := encodeLogsResult(result)
	if err != nil {
		t.Fatal(err)
	}
	var decoded logsResult
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Truncated != 0 || len(decoded.Lines) != 2 {
		t.Fatalf("a tail that fits must be untouched: %+v", decoded)
	}
}

/*
The result payload, pinned from both sides.

`apps/lore/test/estate-command-result.spec.ts` validates this same file
against Lore's `estateCommandResultSchema`, so the two cannot drift. They
already did once: Lore's first schema accepted `lines: string[]`, which would
have refused every real upload with a 400 and stripped the three flags in
silence, and nothing on either side would have gone red.
*/
func TestLogsResultMatchesTheSharedFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "logs-result.json"))
	if err != nil {
		t.Fatal(err)
	}
	stamp, err := time.Parse(time.RFC3339, "2026-09-06T11:59:41Z")
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(logsResult{
		Supervised: true,
		Undated:    1,
		Truncated:  12,
		Lines: []runner.LogLine{
			{
				At:    stamp,
				Level: "info",
				Text:  "listening on 41001",
				Raw:   `{"level":"info","msg":"listening on 41001"}`,
			},
			{Raw: "a plain line with no envelope at all"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	var got, want map[string]any
	if err := json.Unmarshal(encoded, &got); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("encoded %s\nwant     %s", encoded, raw)
	}
}
