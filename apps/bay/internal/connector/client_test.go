package connector

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

const clientSecret = "est_0123456789abcdef0123456789abcdef"

/*
fakeLore is a websocket server speaking wire format v1 from the other side:
it checks the bearer, waits for hello, answers welcome, and hands each
session to the test to drive.
*/
type fakeLore struct {
	t        *testing.T
	srv      *httptest.Server
	sessions chan *loreSession
	// answerPings decides whether the server pongs. Off, a client that
	// treats a missing pong as a drop must redial.
	answerPings atomic.Bool
	dials       atomic.Int32
}

type loreSession struct {
	conn   *websocket.Conn
	frames chan map[string]any
	pings  atomic.Int32
}

func newFakeLore(t *testing.T) *fakeLore {
	t.Helper()
	l := &fakeLore{t: t, sessions: make(chan *loreSession, 8)}
	l.answerPings.Store(true)
	upgrader := websocket.Upgrader{}
	l.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != SocketPath {
			http.NotFound(w, r)
			return
		}
		l.dials.Add(1)
		if r.Header.Get("Authorization") != "Bearer "+clientSecret {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		s := &loreSession{conn: conn, frames: make(chan map[string]any, 16)}
		conn.SetPingHandler(func(data string) error {
			s.pings.Add(1)
			if !l.answerPings.Load() {
				return nil
			}
			return conn.WriteControl(websocket.PongMessage, []byte(data), time.Now().Add(time.Second))
		})
		l.sessions <- s
		for {
			var frame map[string]any
			if err := conn.ReadJSON(&frame); err != nil {
				close(s.frames)
				return
			}
			s.frames <- frame
		}
	}))
	t.Cleanup(l.srv.Close)
	return l
}

// sink is the http origin the client is configured with; loopback, so
// cleartext is allowed and ws:// is what gets dialed.
func (l *fakeLore) sink() string { return l.srv.URL }

func (l *fakeLore) session(t *testing.T) *loreSession {
	t.Helper()
	select {
	case s := <-l.sessions:
		return s
	case <-time.After(5 * time.Second):
		t.Fatal("no session opened")
		return nil
	}
}

func (s *loreSession) frame(t *testing.T) map[string]any {
	t.Helper()
	select {
	case f, ok := <-s.frames:
		if !ok {
			t.Fatal("session closed before the expected frame")
		}
		return f
	case <-time.After(5 * time.Second):
		t.Fatal("no frame arrived")
		return nil
	}
}

func (s *loreSession) send(t *testing.T, frame map[string]any) {
	t.Helper()
	// The room stamp every real frame carries; the client must drop it.
	frame["__alephaRoom"] = "estate-1"
	if err := s.conn.WriteJSON(frame); err != nil {
		t.Fatal(err)
	}
}

func welcomeFrame() map[string]any {
	return map[string]any{
		"type": "welcome", "protocol": Protocol,
		"estate":        map[string]any{"id": "estate-1", "slug": "ovh-1"},
		"deployAllowed": false, "statsIntervalSeconds": 1800,
	}
}

// recordingHandler is the executor's seat, recording what the connection
// delivers and acking done at once.
type recordingHandler struct {
	mu       sync.Mutex
	welcomes []Welcome
	commands []Command
}

func (h *recordingHandler) Welcome(w Welcome) {
	h.mu.Lock()
	h.welcomes = append(h.welcomes, w)
	h.mu.Unlock()
}

func (h *recordingHandler) Command(_ context.Context, cmd Command, send func(Ack) error) {
	h.mu.Lock()
	h.commands = append(h.commands, cmd)
	h.mu.Unlock()
	_ = send(NewAck(cmd.ID, "running", "", ""))
	_ = send(NewAck(cmd.ID, "done", "", ""))
}

// syncBuffer is a log sink the test may read while the client still writes.
type syncBuffer struct {
	mu sync.Mutex
	b  strings.Builder
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

// fixtureOptions is everything a test decides BEFORE Run starts. The client's
// fields are read from Run's goroutine, so nothing may be set on it after.
type fixtureOptions struct {
	configured bool
	noExecutor bool
	logs       io.Writer
	gauge      Gauge
}

type clientFixture struct {
	lore    *fakeLore
	store   *Store
	client  *Client
	handler *recordingHandler
	reload  chan struct{}
}

func newClientFixture(t *testing.T, opts fixtureOptions) *clientFixture {
	t.Helper()
	lore := newFakeLore(t)
	store := NewStore(t.TempDir())
	if opts.configured {
		if err := store.Set(Config{Sink: lore.sink(), Secret: clientSecret}); err != nil {
			t.Fatal(err)
		}
	}
	if opts.logs == nil {
		opts.logs = io.Discard
	}
	handler := &recordingHandler{}
	reload := make(chan struct{}, 1)
	client := &Client{
		Store: store, Status: NewStatus(), Reload: reload,
		Log:          slog.New(slog.NewTextHandler(opts.logs, nil)),
		PingInterval: 40 * time.Millisecond, PongWait: 40 * time.Millisecond,
		MinBackoff: 5 * time.Millisecond, MaxBackoff: 20 * time.Millisecond,
		Gauge: opts.gauge, MinStatsInterval: 10 * time.Millisecond,
	}
	if !opts.noExecutor {
		client.Handler = handler
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
	return &clientFixture{lore: lore, store: store, client: client, handler: handler, reload: reload}
}

func eventually(t *testing.T, what string, ok func() bool) {
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

func TestClientSpeaksFirstAndCachesTheWelcome(t *testing.T) {
	f := newClientFixture(t, fixtureOptions{configured: true})
	s := f.lore.session(t)

	// Nothing arrives before hello: on production Lore can only reply.
	first := s.frame(t)
	if first["type"] != "hello" {
		t.Fatalf("the first frame must be hello, got %v", first)
	}
	if !f.client.Status.Snapshot().Connected {
		t.Fatal("status must read up once the handshake succeeded")
	}

	s.send(t, welcomeFrame())
	eventually(t, "the welcome to be cached", func() bool {
		w, ok, _ := f.store.LoadWelcome()
		return ok && w.Slug == "ovh-1" && w.EstateID == "estate-1" && w.StatsIntervalSeconds == 1800
	})
	eventually(t, "the handler to see the welcome", func() bool {
		f.handler.mu.Lock()
		defer f.handler.mu.Unlock()
		return len(f.handler.welcomes) == 1
	})

	// A config frame replaces it: the switch just flipped.
	cfg := welcomeFrame()
	cfg["type"] = "config"
	cfg["deployAllowed"] = true
	cfg["statsIntervalSeconds"] = 300
	s.send(t, cfg)
	eventually(t, "the config to replace the welcome", func() bool {
		w, ok, _ := f.store.LoadWelcome()
		return ok && w.DeployAllowed && w.StatsIntervalSeconds == 300
	})
}

func TestClientDeliversCommandsAndAcksOverTheSameSocket(t *testing.T) {
	f := newClientFixture(t, fixtureOptions{configured: true})
	s := f.lore.session(t)
	_ = s.frame(t) // hello
	s.send(t, welcomeFrame())
	s.send(t, map[string]any{
		"type": "command", "id": "cmd-1", "kind": "restart",
		"app": "lore", "environment": "production",
	})

	running := s.frame(t)
	if running["type"] != "ack" || running["id"] != "cmd-1" || running["status"] != "running" {
		t.Fatalf("expected a running ack first, got %v", running)
	}
	done := s.frame(t)
	if done["status"] != "done" || done["id"] != "cmd-1" {
		t.Fatalf("expected the terminal ack, got %v", done)
	}
	f.handler.mu.Lock()
	defer f.handler.mu.Unlock()
	if len(f.handler.commands) != 1 || f.handler.commands[0].Kind != "restart" || f.handler.commands[0].App != "lore" {
		t.Fatalf("the handler did not receive the command as sent: %+v", f.handler.commands)
	}
}

func TestClientRefusesCommandsWithNoExecutor(t *testing.T) {
	f := newClientFixture(t, fixtureOptions{configured: true, noExecutor: true})
	s := f.lore.session(t)
	_ = s.frame(t)
	s.send(t, map[string]any{"type": "command", "id": "cmd-9", "kind": "restart", "app": "a", "environment": "b"})
	ack := s.frame(t)
	if ack["status"] != "failed" || ack["id"] != "cmd-9" || !strings.Contains(ack["reason"].(string), "executor") {
		t.Fatalf("a command with nobody to run it must be refused with a reason, got %v", ack)
	}
}

func TestClientReconnectsWithBackoffAndLogsOnce(t *testing.T) {
	logs := &syncBuffer{}
	f := newClientFixture(t, fixtureOptions{configured: true, logs: logs})
	first := f.lore.session(t)
	_ = first.frame(t)

	// Lore goes away: the server closes the socket.
	_ = first.conn.Close()

	// Down and up again within one 5 ms backoff is faster than a poll can
	// see, so the drop is asserted by its consequences: a second session that
	// starts over, and the two log lines.
	second := f.lore.session(t)
	if second.frame(t)["type"] != "hello" {
		t.Fatal("a reconnect must start over with hello")
	}
	eventually(t, "status to read up again", func() bool { return f.client.Status.Snapshot().Connected })
	eventually(t, "the recovery to be logged", func() bool {
		return strings.Contains(logs.String(), "lore connection restored")
	})

	text := logs.String()
	if n := strings.Count(text, "lore connection lost"); n != 1 {
		t.Fatalf("the outage must be logged once, got %d times:\n%s", n, text)
	}
	if n := strings.Count(text, "lore connection restored"); n != 1 {
		t.Fatalf("the recovery must be logged once, got %d times:\n%s", n, text)
	}
}

func TestClientLogsAnUnreachableSinkOnceNotPerAttempt(t *testing.T) {
	lore := newFakeLore(t)
	sink := lore.sink()
	lore.srv.Close()
	store := NewStore(t.TempDir())
	if err := store.Set(Config{Sink: sink, Secret: clientSecret}); err != nil {
		t.Fatal(err)
	}
	var dials atomic.Int32
	logs := &syncBuffer{}
	client := &Client{
		Store: store, Status: NewStatus(), Log: slog.New(slog.NewTextHandler(logs, nil)),
		MinBackoff: time.Millisecond, MaxBackoff: 2 * time.Millisecond,
		Dial: func(ctx context.Context, url string, header http.Header) (Conn, error) {
			dials.Add(1)
			return nil, errors.New("dial tcp: connection refused")
		},
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { client.Run(ctx); close(done) }()
	eventually(t, "several dial attempts", func() bool { return dials.Load() >= 5 })
	cancel()
	<-done

	if n := strings.Count(logs.String(), "lore connection down"); n != 1 {
		t.Fatalf("an outage must be logged once, got %d:\n%s", n, logs.String())
	}
	snap := client.Status.Snapshot()
	if snap.Connected || !strings.Contains(snap.LastError, "refused") {
		t.Fatalf("status must carry the last error: %+v", snap)
	}
}

func TestClientDialsNobodyUntilConfiguredThenWakesOnReload(t *testing.T) {
	f := newClientFixture(t, fixtureOptions{configured: false})
	time.Sleep(30 * time.Millisecond)
	if f.lore.dials.Load() != 0 {
		t.Fatal("an unconfigured connector must make no outbound connection at all")
	}

	// `bay connector set` writes the file and pokes the reload.
	if err := f.store.Set(Config{Sink: f.lore.sink(), Secret: clientSecret}); err != nil {
		t.Fatal(err)
	}
	f.reload <- struct{}{}
	s := f.lore.session(t)
	if s.frame(t)["type"] != "hello" {
		t.Fatal("the reload must lead to a dial")
	}

	// `bay connector clear` does the reverse: the open session is dropped
	// on the next event and no new one is dialed.
	if err := f.store.Clear(); err != nil {
		t.Fatal(err)
	}
	_ = s.conn.Close()
	f.reload <- struct{}{}
	eventually(t, "status to read down", func() bool { return !f.client.Status.Snapshot().Connected })
	before := f.lore.dials.Load()
	time.Sleep(60 * time.Millisecond)
	if f.lore.dials.Load() != before {
		t.Fatal("a cleared connector must stop dialing")
	}
}

func TestClientPingsAndTreatsAMissingPongAsADrop(t *testing.T) {
	f := newClientFixture(t, fixtureOptions{configured: true})
	first := f.lore.session(t)
	_ = first.frame(t)
	eventually(t, "pings to arrive", func() bool { return first.pings.Load() >= 2 })
	if !f.client.Status.Snapshot().Connected {
		t.Fatal("answered pings keep the connection up")
	}

	// Lore stops answering: the read deadline expires and the client redials.
	f.lore.answerPings.Store(false)
	second := f.lore.session(t)
	if second.frame(t)["type"] != "hello" {
		t.Fatal("a missing pong must end in a redial")
	}
}

func TestClientSendFailsWhileDown(t *testing.T) {
	c := &Client{}
	if err := c.Send(NewAck("x", "done", "", "")); !errors.Is(err, ErrNotConnected) {
		t.Fatalf("Send while down = %v, want ErrNotConnected", err)
	}
}

func TestFrameDecodingDropsTheRoomStampAndKeepsTheArtifact(t *testing.T) {
	raw := []byte(`{"type":"command","id":"c1","kind":"deploy","app":"lore","environment":"production",
		"artifact":{"id":"a1","sha256":"` + strings.Repeat("f", 64) + `","size":12},"__alephaRoom":"estate-1"}`)
	f, err := decodeFrame(raw)
	if err != nil {
		t.Fatal(err)
	}
	if f.Type != "command" || f.Kind != "deploy" || f.Artifact == nil || f.Artifact.Size != 12 {
		t.Fatalf("decoded wrong: %+v", f)
	}

	ack, _ := json.Marshal(NewAck("c1", "failed", "verify", "digest mismatch"))
	if string(ack) != `{"type":"ack","id":"c1","status":"failed","step":"verify","reason":"digest mismatch"}` {
		t.Fatalf("ack wire shape drifted: %s", ack)
	}
	stats, _ := json.Marshal(Stats{Type: "stats", CPUPercent: 12.5, MemoryPercent: 40, At: "2026-09-05T12:00:00Z"})
	if string(stats) != `{"type":"stats","cpuPercent":12.5,"memoryPercent":40,"at":"2026-09-05T12:00:00Z"}` {
		t.Fatalf("stats wire shape drifted: %s", stats)
	}
}

func TestClientRefusesAWrongSecretWithoutASession(t *testing.T) {
	lore := newFakeLore(t)
	store := NewStore(t.TempDir())
	if err := store.Set(Config{Sink: lore.sink(), Secret: "est_wrong_wrong_wrong_wrong"}); err != nil {
		t.Fatal(err)
	}
	client := &Client{Store: store, Status: NewStatus(), Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
		MinBackoff: time.Millisecond, MaxBackoff: 2 * time.Millisecond}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { client.Run(ctx); close(done) }()
	eventually(t, "the 401 to be recorded", func() bool {
		return strings.Contains(client.Status.Snapshot().LastError, "401")
	})
	cancel()
	<-done
	select {
	case <-lore.sessions:
		t.Fatal("a refused handshake must open no session")
	default:
	}
}

// fixedGauge answers the same reading every time, or nothing at all.
type fixedGauge struct {
	reading Reading
	ok      bool
}

func (g fixedGauge) Sample(context.Context) (Reading, bool) { return g.reading, g.ok }

func (g fixedGauge) Host(context.Context) (Host, bool) { return g.reading.Host, g.ok }

func (s *loreSession) statsFrame(t *testing.T, within time.Duration) (map[string]any, bool) {
	t.Helper()
	deadline := time.After(within)
	for {
		select {
		case f, ok := <-s.frames:
			if !ok {
				t.Fatal("session closed while waiting for stats")
			}
			if f["type"] == "stats" {
				return f, true
			}
		case <-deadline:
			return nil, false
		}
	}
}

func TestClientPushesTheGaugeAfterTheWelcomeAndOnTheInterval(t *testing.T) {
	f := newClientFixture(t, fixtureOptions{
		configured: true,
		gauge:      fixedGauge{reading: Reading{CPUPercent: 12.34, MemoryPercent: 56.78}, ok: true},
	})
	s := f.lore.session(t)
	_ = s.frame(t) // hello

	// Nothing before the welcome: the interval is Lore's to name.
	if _, got := s.statsFrame(t, 50*time.Millisecond); got {
		t.Fatal("no stats may go out before the welcome")
	}

	w := welcomeFrame()
	w["statsIntervalSeconds"] = 1
	s.send(t, w)

	// One push right after the welcome, so a fresh estate shows a figure
	// within seconds rather than an interval later.
	first, ok := s.statsFrame(t, 2*time.Second)
	if !ok {
		t.Fatal("the welcome must be followed by a stats push")
	}
	if first["cpuPercent"] != 12.3 || first["memoryPercent"] != 56.8 {
		t.Fatalf("stats must be rounded to a tenth: %v", first)
	}
	if _, err := time.Parse(time.RFC3339, first["at"].(string)); err != nil {
		t.Fatalf("at must be RFC 3339: %v", first["at"])
	}

	// Then on the interval the welcome named.
	if _, ok := s.statsFrame(t, 3*time.Second); !ok {
		t.Fatal("the gauge must keep pushing on the interval")
	}
}

func TestClientPushesNothingWhenTheGaugeHasNothing(t *testing.T) {
	f := newClientFixture(t, fixtureOptions{configured: true, gauge: fixedGauge{ok: false}})
	s := f.lore.session(t)
	_ = s.frame(t)
	w := welcomeFrame()
	w["statsIntervalSeconds"] = 1
	s.send(t, w)
	if _, got := s.statsFrame(t, 200*time.Millisecond); got {
		t.Fatal("a gauge with nothing to say must send nothing, never zeros")
	}
}

func TestStatsIntervalFloorsAndDefaults(t *testing.T) {
	c := &Client{MinStatsInterval: time.Minute}
	if got := c.statsInterval(); got != 1800*time.Second {
		t.Fatalf("no welcome yet: %v, want 30m", got)
	}
	c.statsSeconds.Store(30)
	if got := c.statsInterval(); got != time.Minute {
		t.Fatalf("under the floor: %v, want 1m", got)
	}
	c.statsSeconds.Store(3600)
	if got := c.statsInterval(); got != time.Hour {
		t.Fatalf("named interval: %v, want 1h", got)
	}
}
