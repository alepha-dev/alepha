package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/alepha/bay/internal/connector"
)

/*
The connector end to end, against a stub Lore: the real client, the real
executor over the deploy fixture, and a websocket sink speaking wire format v1
and nothing else. It runs natively and under yarn v:go alike; nothing here
depends on a running Lore, and the frames the stub sends come from the same
fixtures Lore's own suite validates, so the stub's vocabulary cannot drift on
its own.

The stub does what Lore does: waits for hello, answers welcome, then pushes
whatever it holds for that estate (the reconciliation), records every ack and
stats frame, and serves the two pull routes for a deploy.
*/

const wireFixtures = "../../internal/connector/testdata/wire-v1"

func wireFixture(t *testing.T, name string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(wireFixtures, name))
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

type stubSession struct {
	conn   *websocket.Conn
	frames chan map[string]any
	pings  atomic.Int32
}

type stubLore struct {
	srv      *httptest.Server
	sessions chan *stubSession

	mu            sync.Mutex
	deployAllowed bool
	// queued is what the sink holds for the estate and pushes after the next
	// hello, the way Lore's reconciliation redelivers what is unacknowledged.
	queued []map[string]any

	answerPings  atomic.Bool
	artifact     []byte
	artifactHits atomic.Int32
	secrets      string
}

func newStubLore(t *testing.T) *stubLore {
	t.Helper()
	l := &stubLore{sessions: make(chan *stubSession, 8), secrets: "{}"}
	l.answerPings.Store(true)
	upgrader := websocket.Upgrader{}
	mux := http.NewServeMux()
	mux.HandleFunc(connector.SocketPath, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+testSecret {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		s := &stubSession{conn: conn, frames: make(chan map[string]any, 64)}
		conn.SetPingHandler(func(data string) error {
			s.pings.Add(1)
			if !l.answerPings.Load() {
				return nil
			}
			return conn.WriteControl(websocket.PongMessage, []byte(data), time.Now().Add(time.Second))
		})

		// The machine speaks first.
		var hello map[string]any
		if err := conn.ReadJSON(&hello); err != nil || hello["type"] != "hello" {
			conn.Close()
			return
		}
		welcome := wireFixture(t, "welcome.json")
		l.mu.Lock()
		welcome["deployAllowed"] = l.deployAllowed
		welcome["__alephaRoom"] = welcome["estate"].(map[string]any)["id"]
		queued := l.queued
		l.queued = nil
		l.mu.Unlock()
		if err := conn.WriteJSON(welcome); err != nil {
			conn.Close()
			return
		}
		for _, cmd := range queued {
			if err := conn.WriteJSON(cmd); err != nil {
				conn.Close()
				return
			}
		}
		l.sessions <- s
		for {
			var frame map[string]any
			if err := conn.ReadJSON(&frame); err != nil {
				close(s.frames)
				return
			}
			s.frames <- frame
		}
	})
	mux.HandleFunc("GET /estates/commands/{id}/artifact", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+testSecret {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		l.artifactHits.Add(1)
		sum := sha256.Sum256(l.artifact)
		w.Header().Set(connector.ArtifactDigestHeader, hex.EncodeToString(sum[:]))
		_, _ = w.Write(l.artifact)
	})
	mux.HandleFunc("GET /estates/commands/{id}/secrets", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+testSecret {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(l.secrets))
	})
	l.srv = httptest.NewServer(mux)
	t.Cleanup(l.srv.Close)
	return l
}

func (l *stubLore) setDeployAllowed(v bool) {
	l.mu.Lock()
	l.deployAllowed = v
	l.mu.Unlock()
}

// queue holds a command for the estate until its next hello.
func (l *stubLore) queue(cmd map[string]any) {
	l.mu.Lock()
	l.queued = append(l.queued, cmd)
	l.mu.Unlock()
}

func (l *stubLore) session(t *testing.T) *stubSession {
	t.Helper()
	select {
	case s := <-l.sessions:
		return s
	case <-time.After(5 * time.Second):
		t.Fatal("no session opened")
		return nil
	}
}

// push sends a command on an open session, stamped the way Lore stamps it.
func (s *stubSession) push(t *testing.T, cmd map[string]any) {
	t.Helper()
	cmd["__alephaRoom"] = "6f1c2f9a-2b5e-4c1d-9a3e-8d7b6c5a4f30"
	if err := s.conn.WriteJSON(cmd); err != nil {
		t.Fatal(err)
	}
}

// ack waits for the ack of one command with one status, skipping stats and
// every other ack on the way.
func (s *stubSession) ack(t *testing.T, id, status string) map[string]any {
	t.Helper()
	deadline := time.After(10 * time.Second)
	for {
		select {
		case f, ok := <-s.frames:
			if !ok {
				t.Fatalf("session closed before ack %s/%s", id, status)
			}
			if f["type"] == "ack" && f["id"] == id && f["status"] == status {
				return f
			}
		case <-deadline:
			t.Fatalf("no ack %s/%s arrived", id, status)
		}
	}
}

// restartOf is the restart fixture with a fresh id.
func restartOf(t *testing.T, id string) map[string]any {
	cmd := wireFixture(t, "command-restart.json")
	cmd["id"] = id
	cmd["app"] = "demo"
	return cmd
}

func deployOf(t *testing.T, id string, artifact []byte) map[string]any {
	cmd := wireFixture(t, "command-deploy.json")
	cmd["id"] = id
	cmd["app"] = "demo"
	sum := sha256.Sum256(artifact)
	cmd["artifact"] = map[string]any{
		"id": "9c2b4d6e-8f1a-4c3d-a5b7-e9f0a1b2c3d4", "sha256": hex.EncodeToString(sum[:]), "size": len(artifact),
	}
	return cmd
}

type logBuffer struct {
	mu sync.Mutex
	b  strings.Builder
}

func (l *logBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *logBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

type wired struct {
	f      *deployFixture
	lore   *stubLore
	client *connector.Client
	logs   *logBuffer
}

// wire enrols the fixture's Bay against the stub and starts the real client
// with the real executor, on millisecond timers.
func wire(t *testing.T, f *deployFixture, lore *stubLore) *wired {
	t.Helper()
	if err := connector.NewStore(f.root).Set(connector.Config{Sink: lore.srv.URL, Secret: testSecret}); err != nil {
		t.Fatal(err)
	}
	logs := &logBuffer{}
	f.server.log = slog.New(slog.NewTextHandler(logs, nil))
	f.server.connectorStatus = connector.NewStatus()
	f.server.connectorReload = make(chan struct{}, 1)
	client := &connector.Client{
		Store:        connector.NewStore(f.root),
		Status:       f.server.connectorStatus,
		Log:          f.server.log,
		Reload:       f.server.connectorReload,
		Handler:      newActions(f.server),
		PingInterval: 40 * time.Millisecond, PongWait: 40 * time.Millisecond,
		MinBackoff: 5 * time.Millisecond, MaxBackoff: 20 * time.Millisecond,
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		client.Run(ctx)
		close(done)
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("Run did not return after cancel")
		}
	})
	return &wired{f: f, lore: lore, client: client, logs: logs}
}

func TestIntegrationRestartOverTheWire(t *testing.T) {
	f := deployedApp(t)
	lore := newStubLore(t)
	w := wire(t, f, lore)
	s := lore.session(t)
	before := f.runner.starts

	s.push(t, restartOf(t, "11111111-1111-4111-8111-111111111111"))
	s.ack(t, "11111111-1111-4111-8111-111111111111", "running")
	s.ack(t, "11111111-1111-4111-8111-111111111111", "done")

	if f.runner.starts != before+1 || !f.runner.Running("demo/production") {
		t.Fatalf("the restart did not run: starts %d -> %d", before, f.runner.starts)
	}
	if !w.client.Status.Snapshot().Connected {
		t.Fatal("the connection must still be up after a command")
	}
}

func TestIntegrationUnknownActionIsRefusedOverTheWire(t *testing.T) {
	f := deployedApp(t)
	lore := newStubLore(t)
	wire(t, f, lore)
	s := lore.session(t)
	before := f.runner.starts

	cmd := restartOf(t, "22222222-2222-4222-8222-222222222222")
	cmd["kind"] = "exec"
	s.push(t, cmd)
	ack := s.ack(t, "22222222-2222-4222-8222-222222222222", "failed")
	if !strings.Contains(ack["reason"].(string), "unknown action") {
		t.Fatalf("reason %v", ack["reason"])
	}
	if f.runner.starts != before {
		t.Fatal("a refused action must touch nothing")
	}
}

func TestIntegrationRedeliveredIdDoesNotRunTwice(t *testing.T) {
	f := deployedApp(t)
	lore := newStubLore(t)
	wire(t, f, lore)
	s := lore.session(t)
	before := f.runner.starts
	id := "33333333-3333-4333-8333-333333333333"

	s.push(t, restartOf(t, id))
	s.ack(t, id, "done")
	// Lore lost the ack and delivers the same id again.
	s.push(t, restartOf(t, id))
	s.ack(t, id, "done")

	if f.runner.starts != before+1 {
		t.Fatalf("the id ran %d times, want once", f.runner.starts-before)
	}
}

func TestIntegrationDeployOverTheWire(t *testing.T) {
	f := newDeployFixture(t)
	lore := newStubLore(t)
	artifact, err := os.ReadFile(deployableArtifact(t))
	if err != nil {
		t.Fatal(err)
	}
	lore.artifact = artifact
	lore.setDeployAllowed(true)
	wire(t, f, lore)
	s := lore.session(t)
	id := "44444444-4444-4444-8444-444444444444"

	s.push(t, deployOf(t, id, artifact))
	s.ack(t, id, "done")
	if !f.runner.Running("demo/production") {
		t.Fatal("the deploy did not bring the app up")
	}
	if lore.artifactHits.Load() != 1 {
		t.Fatalf("the artifact was pulled %d times, want once", lore.artifactHits.Load())
	}
}

func TestIntegrationDeployDigestMismatchLeavesNothing(t *testing.T) {
	f := newDeployFixture(t)
	lore := newStubLore(t)
	artifact, err := os.ReadFile(deployableArtifact(t))
	if err != nil {
		t.Fatal(err)
	}
	// The sink serves other bytes than the command names.
	lore.artifact = []byte("not the artifact")
	lore.setDeployAllowed(true)
	wire(t, f, lore)
	s := lore.session(t)
	id := "55555555-5555-4555-8555-555555555555"

	s.push(t, deployOf(t, id, artifact))
	ack := s.ack(t, id, "failed")
	if ack["step"] != "downloading" && ack["step"] != "verifying" {
		t.Fatalf("a mismatch fails before deploying, got step %v", ack["step"])
	}
	if entries, _ := os.ReadDir(filepath.Join(f.root, "artifacts")); len(entries) != 0 {
		t.Fatalf("nothing may be left on disk: %v", entries)
	}
	if f.runner.starts != 0 {
		t.Fatal("no partial deploy may happen")
	}
}

func TestIntegrationDeployRefusedWhenTheWelcomeSaidNo(t *testing.T) {
	f := newDeployFixture(t)
	lore := newStubLore(t)
	artifact, err := os.ReadFile(deployableArtifact(t))
	if err != nil {
		t.Fatal(err)
	}
	lore.artifact = artifact
	lore.setDeployAllowed(false)
	wire(t, f, lore)
	s := lore.session(t)
	id := "66666666-6666-4666-8666-666666666666"

	s.push(t, deployOf(t, id, artifact))
	ack := s.ack(t, id, "failed")
	if !strings.Contains(ack["reason"].(string), "does not accept deploys") {
		t.Fatalf("reason %v", ack["reason"])
	}
	if lore.artifactHits.Load() != 0 {
		t.Fatal("the refusal must come before any fetch")
	}
}

func TestIntegrationDropMidSessionReconnectsAndLeavesTheAppAlone(t *testing.T) {
	f := deployedApp(t)
	lore := newStubLore(t)
	w := wire(t, f, lore)
	first := lore.session(t)
	starts := f.runner.starts

	// Lore goes away.
	_ = first.conn.Close()
	second := lore.session(t)
	if second == nil {
		t.Fatal("no reconnect")
	}
	eventuallyTrue(t, "the connection to be back up", func() bool { return w.client.Status.Snapshot().Connected })
	eventuallyTrue(t, "the recovery to be logged", func() bool {
		return strings.Contains(w.logs.String(), "lore connection restored")
	})

	text := w.logs.String()
	if n := strings.Count(text, "lore connection lost"); n != 1 {
		t.Fatalf("the outage must be logged once, got %d:\n%s", n, text)
	}
	// The app was never touched by any of it.
	if f.runner.starts != starts || !f.runner.Running("demo/production") {
		t.Fatal("a connection drop must not affect a supervised app")
	}

	// And the reconnected session works.
	id := "77777777-7777-4777-8777-777777777777"
	second.push(t, restartOf(t, id))
	second.ack(t, id, "done")
}

func TestIntegrationMissingPongIsADrop(t *testing.T) {
	f := deployedApp(t)
	lore := newStubLore(t)
	wire(t, f, lore)
	first := lore.session(t)
	eventuallyTrue(t, "pings to arrive", func() bool { return first.pings.Load() >= 1 })

	lore.answerPings.Store(false)
	// The read deadline expires within a ping interval plus the pong wait,
	// and the client redials.
	second := lore.session(t)
	if second == nil {
		t.Fatal("no reconnect after the pongs stopped")
	}
}

func TestIntegrationCommandQueuedWhileDownArrivesOnReconnect(t *testing.T) {
	f := deployedApp(t)
	lore := newStubLore(t)
	wire(t, f, lore)
	first := lore.session(t)
	before := f.runner.starts
	id := "88888888-8888-4888-8888-888888888888"

	// The connection is down when Lore queues the command; it is pushed
	// after the next hello, which is exactly what Lore's reconciliation does.
	lore.queue(restartOf(t, id))
	_ = first.conn.Close()

	second := lore.session(t)
	second.ack(t, id, "done")
	if f.runner.starts != before+1 {
		t.Fatal("the queued command must run once on reconnect")
	}
}

func eventuallyTrue(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}
