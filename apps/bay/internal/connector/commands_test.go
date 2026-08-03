package connector

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPollTreatsNoContentAsNoWork(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	cmd, err := Poll(context.Background(), srv.Client(), Connector{Sink: srv.URL, Token: "op_test"})
	if err != nil {
		t.Fatalf("no work is not an error, got: %v", err)
	}
	if cmd != nil {
		t.Fatal("204 must yield no command, not an empty one")
	}
}

func TestPollSendsTheBearerAndPosts(t *testing.T) {
	var seenAuth, seenMethod, seenPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenAuth, seenMethod, seenPath = r.Header.Get("authorization"), r.Method, r.URL.Path
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	if _, err := Poll(context.Background(), srv.Client(), Connector{Sink: srv.URL, Token: "op_test"}); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if seenAuth != "Bearer op_test" {
		t.Fatalf("authorization was %q", seenAuth)
	}
	if seenMethod != http.MethodPost {
		t.Fatalf("method was %q", seenMethod)
	}
	if seenPath != CommandsPath {
		t.Fatalf("path was %q, want %q", seenPath, CommandsPath)
	}
}

func TestPollReadsADeployCommand(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"deploy": map[string]any{
				"releaseId":   "11111111-1111-4111-8111-111111111111",
				"app":         "lindocara-main",
				"environment": "production",
				"version":     "2026-08-03-120000",
				"sha256":      strings.Repeat("c", 64),
				"downloadUrl": "https://lore.test/outposts/artifacts/x",
				"sizeBytes":   33352058,
			},
		})
	}))
	defer srv.Close()

	cmd, err := Poll(context.Background(), srv.Client(), Connector{Sink: srv.URL, Token: "op_test"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cmd == nil {
		t.Fatal("expected a command")
	}
	if cmd.App != "lindocara-main" || cmd.Version != "2026-08-03-120000" {
		t.Fatalf("wrong command: %+v", cmd)
	}
	if cmd.SizeBytes != 33352058 {
		t.Fatalf("sizeBytes was %d", cmd.SizeBytes)
	}
}

// A 200 carrying no command means nothing to do. Guessing otherwise would send
// the machine into a deploy with no artifact.
func TestPollTreatsAnEmptyEnvelopeAsNoWork(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	cmd, err := Poll(context.Background(), srv.Client(), Connector{Sink: srv.URL, Token: "op_test"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cmd != nil {
		t.Fatal("an empty envelope is not work")
	}
}

// The fix for a 401 is a different command from every other failure, so the
// message has to say which one.
func TestPollNamesTheFixForARejectedToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	_, err := Poll(context.Background(), srv.Client(), Connector{Sink: srv.URL, Token: "op_abcdefghijklmnop"})
	if err == nil {
		t.Fatal("expected an error")
	}
	if !strings.Contains(err.Error(), "bay connector add") {
		t.Fatalf("error should name the fix, got: %v", err)
	}
	if strings.Contains(err.Error(), "op_abcdefghijklmnop") {
		t.Fatal("the full token must never reach a log")
	}
}

func TestReportStatusPostsTheTransition(t *testing.T) {
	var seenPath string
	var body map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	err := ReportStatus(context.Background(), srv.Client(),
		Connector{Sink: srv.URL, Token: "op_test"}, "rel-1", "failed", "rebuild with --target=bare")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if seenPath != "/outposts/releases/rel-1/status" {
		t.Fatalf("path was %q", seenPath)
	}
	if body["status"] != "failed" {
		t.Fatalf("status was %q", body["status"])
	}
	// Bay's own sentence has to survive the trip: it is the part that says what
	// to do, and the person reading it is looking at a CI log, not this host.
	if body["failureReason"] != "rebuild with --target=bare" {
		t.Fatalf("failureReason was %q", body["failureReason"])
	}
}

func TestReportStatusSurfacesARefusal(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"message":"No such release claimed by this outpost"}`))
	}))
	defer srv.Close()

	err := ReportStatus(context.Background(), srv.Client(),
		Connector{Sink: srv.URL, Token: "op_test"}, "rel-1", "serving", "")
	if err == nil {
		t.Fatal("expected an error")
	}
	if !strings.Contains(err.Error(), "No such release claimed") {
		t.Fatalf("error should carry the sink's message, got: %v", err)
	}
}
