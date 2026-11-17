package proxy

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"log/slog"
	"net"
	"strconv"
	"sync"
	"time"
)

/*
TCP forwards raw TCP ports to stack services: `x-lore.tcp: 8883` opens 8883 on
every interface and forwards each connection to the service's loopback port.

Opt-in per service, because it is the one door Bay opens that its HTTP proxy
does not guard: no Host routing, the protocol is the service's own (MQTT, a
game server). TLS is the service's own too, unless `x-lore.tls` asks Bay to
terminate it, since Bay is what holds the certificates on a host.
*/
type TCP struct {
	log       *slog.Logger
	mu        sync.Mutex
	listeners map[int]*tcpListener
	// Listen opens a public port; nil means net.Listen. `serve` hands it the
	// socket handoff's, so a Bay taking over from a running one inherits each
	// open port instead of binding it again (#Q3743).
	Listen func(network, addr string) (net.Listener, error)
	// loops counts the accept loops and active the connections being
	// forwarded, for Drain. Two groups, and Drain waits for them in that
	// order: a loop that has just accepted a connection has not counted it
	// yet, so waiting for the connections alone would miss that one.
	loops  sync.WaitGroup
	active sync.WaitGroup
}

type tcpListener struct {
	ln  net.Listener
	fwd Forward
}

// Forward is where a public port leads.
type Forward struct {
	// Target is the service's loopback port.
	Target int
	// TLS terminates TLS on the public port when set.
	TLS *tls.Config
}

// tlsHandshakeTimeout bounds a client that connects and never says hello.
const tlsHandshakeTimeout = 10 * time.Second

// NewTCP returns a forwarder with nothing open.
func NewTCP(log *slog.Logger) *TCP {
	return &TCP{log: log, listeners: map[int]*tcpListener{}}
}

/*
Sync makes the open listeners exactly `forwards` (public port -> loopback
port): new ones are opened, gone ones closed, moved targets repointed without
dropping the listener. Answers the ports that could not be opened.
*/
func (t *TCP) Sync(forwards map[int]Forward) map[int]error {
	t.mu.Lock()
	defer t.mu.Unlock()
	failed := map[int]error{}
	for port, l := range t.listeners {
		if _, keep := forwards[port]; !keep {
			// Not a plain close: see retire.
			retire(l.ln)
			delete(t.listeners, port)
		}
	}
	for port, fwd := range forwards {
		if l, ok := t.listeners[port]; ok {
			l.fwd = fwd
			continue
		}
		listen := t.Listen
		if listen == nil {
			listen = net.Listen
		}
		ln, err := listen("tcp", ":"+strconv.Itoa(port))
		if err != nil {
			failed[port] = err
			continue
		}
		l := &tcpListener{ln: ln, fwd: fwd}
		t.listeners[port] = l
		t.loops.Add(1)
		go t.serve(port, l)
	}
	return failed
}

// Owns reports whether the forwarder holds a public port.
func (t *TCP) Owns(port int) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	_, ok := t.listeners[port]
	return ok
}

// Close retires every port: nothing listens on any of them afterwards.
func (t *TCP) Close() { t.Sync(nil) }

/*
Drain is how a Bay that has handed its sockets to its successor leaves: it
stops accepting on every port, then waits for the connections it is still
forwarding, until ctx is done.

The listeners are closed, not retired. The successor accepts on the same
sockets, and retiring one here would stop it listening there too.
*/
func (t *TCP) Drain(ctx context.Context) {
	t.mu.Lock()
	for port, l := range t.listeners {
		l.ln.Close()
		delete(t.listeners, port)
	}
	t.mu.Unlock()
	done := make(chan struct{})
	go func() {
		t.loops.Wait()
		t.active.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
	}
}

func (t *TCP) serve(port int, l *tcpListener) {
	defer t.loops.Done()
	for {
		conn, err := l.ln.Accept()
		if err != nil {
			return
		}
		t.mu.Lock()
		fwd := l.fwd
		t.active.Add(1)
		t.mu.Unlock()
		go func() {
			defer t.active.Done()
			forward(conn, fwd, t.log, port)
		}()
	}
}

func forward(client net.Conn, fwd Forward, log *slog.Logger, port int) {
	defer client.Close()
	target := fwd.Target
	if fwd.TLS != nil {
		conn := tls.Server(client, fwd.TLS)
		ctx, cancel := context.WithTimeout(context.Background(), tlsHandshakeTimeout)
		defer cancel()
		if err := conn.HandshakeContext(ctx); err != nil {
			if log != nil {
				log.Debug("tcp tls handshake failed", "port", port, "err", err)
			}
			return
		}
		client = conn
	}
	upstream, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(target)), 5*time.Second)
	if err != nil {
		if log != nil {
			log.Error("tcp upstream unreachable", "port", port, "target", target, "err", err)
		}
		return
	}
	defer upstream.Close()
	done := make(chan struct{}, 2)
	pipe := func(dst, src net.Conn) {
		_, _ = io.Copy(dst, src)
		if c, ok := dst.(interface{ CloseWrite() error }); ok {
			_ = c.CloseWrite()
		}
		done <- struct{}{}
	}
	go pipe(upstream, client)
	go pipe(client, upstream)
	<-done
	<-done
}

// PortFree reports whether a public port can be opened right now.
func PortFree(port int) error {
	ln, err := net.Listen("tcp", ":"+strconv.Itoa(port))
	if err != nil {
		return fmt.Errorf("port %d is in use on this host", port)
	}
	return ln.Close()
}
