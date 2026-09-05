package connector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

/*
Wire format v1, folio #1198.

Lore's `$channel` schemas are the source of truth: `estateServerFrameSchema.ts`
for what arrives here and `estateClientFrameSchema.ts` for what leaves.
These structs mirror them by hand, and the end-to-end test (#1628) is what
catches the two drifting apart. Every frame Lore sends also carries a
`__alephaRoom` key stamped by the framework; `encoding/json` drops it as an
unknown field, which is the whole handling it needs.

The machine speaks first. On production the handler on the Lore side runs
inside the Durable Object holding the socket and can only reply into it, so
nothing arrives before this side sends `hello`: Lore answers with `welcome`
and then every command still unacknowledged, oldest first.
*/

// Protocol is the wire format this Bay speaks.
const Protocol = 1

// Command is what Lore asks for. The vocabulary is closed and enumerated on
// both sides: `kind` is an enum, `app` and `environment` name an instance this
// Bay already has, and nothing here is a path, a shell command or an argument
// list. The executor (#1621) is where an unknown kind is refused.
type Command struct {
	ID          string    `json:"id"`
	Kind        string    `json:"kind"`
	App         string    `json:"app"`
	Environment string    `json:"environment"`
	Artifact    *Artifact `json:"artifact,omitempty"`
}

// Artifact names the bytes a deploy fetches, by digest. The bytes themselves
// are pulled by command id from the sink (#1622), never carried here.
type Artifact struct {
	ID     string `json:"id"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

// Ack is what this Bay says about a command: `running` on pickup, then `done`
// or `failed` with a reason, over the same connection.
type Ack struct {
	Type   string `json:"type"`
	ID     string `json:"id"`
	Status string `json:"status"`
	Step   string `json:"step,omitempty"`
	Reason string `json:"reason,omitempty"`
}

// NewAck builds an ack frame; the type is always "ack".
func NewAck(id, status, step, reason string) Ack {
	return Ack{Type: "ack", ID: id, Status: status, Step: step, Reason: reason}
}

// Stats is the gauge this Bay pushes on its interval (#1623).
type Stats struct {
	Type          string  `json:"type"`
	CPUPercent    float64 `json:"cpuPercent"`
	MemoryPercent float64 `json:"memoryPercent"`
	At            string  `json:"at"`
}

// serverFrame is the union of everything Lore sends, decoded once and
// dispatched on `type`. One struct rather than three because the discriminator
// has to be read before the shape is known, and a second decode of the same
// bytes buys nothing.
type serverFrame struct {
	Type string `json:"type"`

	// welcome and config
	Protocol int `json:"protocol,omitempty"`
	Estate   struct {
		ID   string `json:"id"`
		Slug string `json:"slug"`
	} `json:"estate,omitempty"`
	DeployAllowed        bool `json:"deployAllowed,omitempty"`
	StatsIntervalSeconds int  `json:"statsIntervalSeconds,omitempty"`

	// command
	ID          string    `json:"id,omitempty"`
	Kind        string    `json:"kind,omitempty"`
	App         string    `json:"app,omitempty"`
	Environment string    `json:"environment,omitempty"`
	Artifact    *Artifact `json:"artifact,omitempty"`
}

// Handler receives what the connection delivers. The executor (#1621) is the
// real one; nil means every command is refused with a reason rather than left
// unacknowledged.
type Handler interface {
	// Welcome is called on every welcome and config frame, after it has been
	// cached on disk for the commands that run in another process.
	Welcome(w Welcome)
	// Command is called for every command frame, on its own goroutine so a
	// long deploy never blocks the read loop or the keepalive. It acknowledges
	// through send, which fails if the connection is gone; the executor keeps
	// the outcome and Lore's reconciliation redelivers the id, so a lost ack
	// is re-sent from what was stored rather than re-run.
	Command(ctx context.Context, cmd Command, send func(Ack) error)
}

// Conn is what the client needs from a websocket, satisfied by
// *websocket.Conn and narrow enough to fake.
type Conn interface {
	ReadJSON(v any) error
	WriteJSON(v any) error
	WriteControl(messageType int, data []byte, deadline time.Time) error
	SetReadDeadline(t time.Time) error
	SetPongHandler(h func(appData string) error)
	Close() error
}

// Dialer opens one connection. The default is gorilla's; tests substitute
// one that counts.
type Dialer func(ctx context.Context, url string, header http.Header) (Conn, error)

// ErrNotConnected is what Send answers while the socket is down: the caller
// keeps its outcome and the reconciliation on the next connect asks again.
var ErrNotConnected = errors.New("not connected to lore")

const (
	// DefaultPingInterval is how often this Bay pings. The server does not
	// always ping: Lore's Node provider does every 30 s, the Cloudflare
	// Durable Object never does, so a half-open connection on production
	// would sit there until a send failed. Cloudflare answers protocol pings
	// without waking the object, so this costs the sink nothing.
	DefaultPingInterval = 30 * time.Second
	// DefaultPongWait is how long a ping may go unanswered before the
	// connection is called dead and redialed.
	DefaultPongWait = 10 * time.Second
	// DefaultMinBackoff and DefaultMaxBackoff bound the reconnect delay,
	// with full jitter in between.
	DefaultMinBackoff = time.Second
	DefaultMaxBackoff = 60 * time.Second
	// DefaultDialTimeout bounds one handshake.
	DefaultDialTimeout = 15 * time.Second
)

/*
Client holds one connection to the configured sink open for the life of the
process, and redials it when it drops.

An unreachable or dropped connection is normal, not exceptional: Lore
redeploys, networks blip. The outage is logged once when it starts and once
when it ends, never on every attempt, because a stack trace every minute of
somebody else's outage is how a log stops being read. Nothing `bay serve` does
for its apps waits on this: the loop runs beside the proxy and touches nothing
of it.

There is no tick for commands. They arrive as pushes over the open socket the
instant Lore queues them; the only clocks here are the keepalive ping and the
reconnect backoff, and neither has anything to do with command latency.
*/
type Client struct {
	Store   *Store
	Status  *Status
	Log     *slog.Logger
	Handler Handler
	// Reload wakes the loop after `bay connector set` or `clear`, so a new
	// sink is dialed now rather than at the end of the current backoff.
	Reload <-chan struct{}

	Dial         Dialer
	PingInterval time.Duration
	PongWait     time.Duration
	MinBackoff   time.Duration
	MaxBackoff   time.Duration
	DialTimeout  time.Duration
	Now          func() time.Time

	mu   sync.Mutex
	conn Conn
}

func (c *Client) defaults() {
	if c.Dial == nil {
		c.Dial = gorillaDial
	}
	if c.PingInterval == 0 {
		c.PingInterval = DefaultPingInterval
	}
	if c.PongWait == 0 {
		c.PongWait = DefaultPongWait
	}
	if c.MinBackoff == 0 {
		c.MinBackoff = DefaultMinBackoff
	}
	if c.MaxBackoff == 0 {
		c.MaxBackoff = DefaultMaxBackoff
	}
	if c.DialTimeout == 0 {
		c.DialTimeout = DefaultDialTimeout
	}
	if c.Now == nil {
		c.Now = time.Now
	}
	if c.Log == nil {
		c.Log = slog.Default()
	}
	if c.Status == nil {
		c.Status = NewStatus()
	}
}

func gorillaDial(ctx context.Context, url string, header http.Header) (Conn, error) {
	conn, res, err := websocket.DefaultDialer.DialContext(ctx, url, header)
	if err != nil {
		if res != nil {
			// The status is the whole diagnosis for the common failures: 401
			// is a wrong or rotated secret, 404 a sink that is not a Lore.
			return nil, fmt.Errorf("%w (http %d)", err, res.StatusCode)
		}
		return nil, err
	}
	return conn, nil
}

// Run dials, holds, and redials until ctx ends. It never returns early.
func (c *Client) Run(ctx context.Context) {
	c.defaults()
	outage := false
	backoff := c.MinBackoff
	for ctx.Err() == nil {
		// Re-read before every dial: `set` and `clear` edit the file, and a
		// missed poke then costs one backoff step rather than a restart.
		cfg, ok, err := c.Store.Load()
		if err != nil {
			c.Log.Warn("connector config unreadable", "err", err)
			if !c.wait(ctx, c.MaxBackoff) {
				return
			}
			continue
		}
		if !ok {
			// Inert. No default sink: an unconfigured Bay dials nobody, and
			// waits here for a reload or the end of the process.
			c.Status.Down(nil)
			if !c.wait(ctx, 0) {
				return
			}
			continue
		}

		connected := c.session(ctx, cfg, &outage)
		if ctx.Err() != nil {
			return
		}
		if connected {
			// A session that got as far as connecting starts the backoff
			// over: the next failure is a new outage, not the same one.
			backoff = c.MinBackoff
		}
		if !c.wait(ctx, jitter(backoff)) {
			return
		}
		backoff = min(backoff*2, c.MaxBackoff)
	}
}

// session runs one connection from dial to drop. It reports whether the
// handshake succeeded, which is what resets the backoff.
func (c *Client) session(ctx context.Context, cfg Config, outage *bool) bool {
	url := SocketURL(cfg.Sink)
	header := http.Header{"Authorization": {"Bearer " + cfg.Secret}}

	dialCtx, cancel := context.WithTimeout(ctx, c.DialTimeout)
	conn, err := c.Dial(dialCtx, url, header)
	cancel()
	if err != nil {
		c.Status.Down(err)
		if !*outage {
			c.Log.Warn("lore connection down", "sink", cfg.Sink, "err", err)
			*outage = true
		} else {
			c.Log.Debug("lore dial failed", "sink", cfg.Sink, "err", err)
		}
		return false
	}

	c.setConn(conn)
	defer c.dropConn(conn)
	c.Status.Up(c.Now())
	if *outage {
		c.Log.Info("lore connection restored", "sink", cfg.Sink)
		*outage = false
	} else {
		c.Log.Info("lore connected", "sink", cfg.Sink)
	}

	// The keepalive. A pong extends the read deadline; a ping that goes
	// unanswered lets the deadline expire, the read fails, and the session
	// ends here as a drop.
	deadline := func() {
		_ = conn.SetReadDeadline(c.Now().Add(c.PingInterval + c.PongWait))
	}
	deadline()
	conn.SetPongHandler(func(string) error {
		deadline()
		return nil
	})
	pingCtx, stopPings := context.WithCancel(ctx)
	defer stopPings()
	go c.pingLoop(pingCtx, conn)

	// The machine speaks first.
	if err := c.Send(map[string]string{"type": "hello"}); err != nil {
		c.dropWith(cfg, outage, err)
		return true
	}

	for {
		var frame serverFrame
		if err := conn.ReadJSON(&frame); err != nil {
			if ctx.Err() != nil {
				return true
			}
			c.dropWith(cfg, outage, err)
			return true
		}
		deadline()
		c.dispatch(ctx, frame)
	}
}

func (c *Client) dropWith(cfg Config, outage *bool, err error) {
	c.Status.Down(err)
	if !*outage {
		c.Log.Warn("lore connection lost", "sink", cfg.Sink, "err", err)
		*outage = true
	}
}

func (c *Client) pingLoop(ctx context.Context, conn Conn) {
	ticker := time.NewTicker(c.PingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// WriteControl is safe beside a concurrent WriteJSON, which is
			// why the keepalive needs no share of the send lock.
			if err := conn.WriteControl(websocket.PingMessage, nil, c.Now().Add(c.PongWait)); err != nil {
				// A ping that cannot be written is a dead socket; closing
				// it unblocks the reader, which ends the session.
				_ = conn.Close()
				return
			}
		}
	}
}

func (c *Client) dispatch(ctx context.Context, frame serverFrame) {
	switch frame.Type {
	case "welcome", "config":
		if frame.Protocol != Protocol {
			// Kept going rather than dropped: a newer Lore still speaks the
			// fields this Bay knows, and refusing would take the machine off
			// the air over a version number.
			c.Log.Warn("lore speaks another protocol version; update bay",
				"lore", frame.Protocol, "bay", Protocol)
		}
		w := Welcome{
			EstateID:             frame.Estate.ID,
			Slug:                 frame.Estate.Slug,
			DeployAllowed:        frame.DeployAllowed,
			StatsIntervalSeconds: frame.StatsIntervalSeconds,
			ReceivedAt:           c.Now(),
		}
		if err := c.Store.SaveWelcome(w); err != nil {
			c.Log.Warn("could not cache the welcome frame", "err", err)
		}
		c.Log.Info("lore "+frame.Type, "estate", w.Slug,
			"deployAllowed", w.DeployAllowed, "statsIntervalSeconds", w.StatsIntervalSeconds)
		if c.Handler != nil {
			c.Handler.Welcome(w)
		}
	case "command":
		cmd := Command{ID: frame.ID, Kind: frame.Kind, App: frame.App,
			Environment: frame.Environment, Artifact: frame.Artifact}
		if c.Handler == nil {
			// Refused with a reason rather than left to Lore's sweep: an
			// unacknowledged command reads as a dead machine, and this one
			// is very much alive.
			_ = c.Send(NewAck(cmd.ID, "failed", "", "this bay has no command executor"))
			return
		}
		go c.Handler.Command(ctx, cmd, c.sendAck)
	default:
		c.Log.Debug("ignoring an unknown frame from lore", "type", frame.Type)
	}
}

// sendAck is Send narrowed to what an executor may say.
func (c *Client) sendAck(ack Ack) error { return c.Send(ack) }

// Send writes one frame on the open connection, serialised: gorilla allows one
// concurrent writer, and acks and stats come from different goroutines.
func (c *Client) Send(frame any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil {
		return ErrNotConnected
	}
	return c.conn.WriteJSON(frame)
}

// Connected reports whether a socket is open right now.
func (c *Client) Connected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn != nil
}

func (c *Client) setConn(conn Conn) {
	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()
}

func (c *Client) dropConn(conn Conn) {
	c.mu.Lock()
	if c.conn == conn {
		c.conn = nil
	}
	c.mu.Unlock()
	_ = conn.Close()
}

// wait sleeps for d, or until a reload poke or the end of the process. A zero
// d waits for the poke alone, which is how an unconfigured Bay idles.
func (c *Client) wait(ctx context.Context, d time.Duration) bool {
	var timer <-chan time.Time
	if d > 0 {
		t := time.NewTimer(d)
		defer t.Stop()
		timer = t.C
	}
	select {
	case <-ctx.Done():
		return false
	case <-c.Reload:
		return true
	case <-timer:
		return true
	}
}

// jitter returns a delay in [0, d]: full jitter, so a fleet that lost the same
// Lore at once does not redial it in lockstep.
func jitter(d time.Duration) time.Duration {
	if d <= 0 {
		return 0
	}
	return time.Duration(rand.Int64N(int64(d) + 1))
}

// decodeFrame is exposed for the tests that pin the wire format.
func decodeFrame(raw []byte) (serverFrame, error) {
	var f serverFrame
	err := json.Unmarshal(raw, &f)
	return f, err
}
