package proxy

import (
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
does not guard: no Host routing, no TLS termination, the protocol is the
service's own (MQTT over TLS, a game server).
*/
type TCP struct {
	log       *slog.Logger
	mu        sync.Mutex
	listeners map[int]*tcpListener
}

type tcpListener struct {
	ln     net.Listener
	target int
}

// NewTCP returns a forwarder with nothing open.
func NewTCP(log *slog.Logger) *TCP {
	return &TCP{log: log, listeners: map[int]*tcpListener{}}
}

/*
Sync makes the open listeners exactly `forwards` (public port -> loopback
port): new ones are opened, gone ones closed, moved targets repointed without
dropping the listener. Answers the ports that could not be opened.
*/
func (t *TCP) Sync(forwards map[int]int) map[int]error {
	t.mu.Lock()
	defer t.mu.Unlock()
	failed := map[int]error{}
	for port, l := range t.listeners {
		if _, keep := forwards[port]; !keep {
			l.ln.Close()
			delete(t.listeners, port)
		}
	}
	for port, target := range forwards {
		if l, ok := t.listeners[port]; ok {
			l.target = target
			continue
		}
		ln, err := net.Listen("tcp", ":"+strconv.Itoa(port))
		if err != nil {
			failed[port] = err
			continue
		}
		l := &tcpListener{ln: ln, target: target}
		t.listeners[port] = l
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

// Close closes every listener.
func (t *TCP) Close() { t.Sync(nil) }

func (t *TCP) serve(port int, l *tcpListener) {
	for {
		conn, err := l.ln.Accept()
		if err != nil {
			return
		}
		t.mu.Lock()
		target := l.target
		t.mu.Unlock()
		go forward(conn, target, t.log, port)
	}
}

func forward(client net.Conn, target int, log *slog.Logger, port int) {
	defer client.Close()
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
		if c, ok := dst.(*net.TCPConn); ok {
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
