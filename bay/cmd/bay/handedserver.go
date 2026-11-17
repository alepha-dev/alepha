package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

/*
handedServer is an http.Server that can leave without dropping a request,
which is what the old process of a socket handoff has to do (#Q3743).

http.Server.Shutdown alone does not. A connection it accepted whose request it
has not read yet is dropped the moment the request arrives: the server reads
it, sees it is shutting down, and closes without answering. In an ordinary
stop that is one refused request among the many a closed port refuses. In a
handoff it is the only one, on a path whose whole point is that there are
none: measured at one handoff in thirty under a request loop.

So leave does it in three steps: close the listener (the successor accepts on
the same socket from then on), wait for every connection that was accepted to
finish what it is doing, then Shutdown, which by then only has idle
keep-alive connections to close.
*/
type handedServer struct {
	srv  *http.Server
	ln   net.Listener
	tls  bool
	name string
	log  *slog.Logger
	// served is closed when Serve has returned: every connection it accepted
	// has been counted by then.
	served  chan struct{}
	leaving atomic.Bool

	mu sync.Mutex
	// busy is the connections with a request to come or in flight: new, or
	// active. An idle keep-alive connection is not in it.
	busy map[net.Conn]struct{}
}

func newHandedServer(srv *http.Server, ln net.Listener, tls bool, name string, log *slog.Logger) *handedServer {
	h := &handedServer{srv: srv, ln: ln, tls: tls, name: name, log: log,
		served: make(chan struct{}), busy: map[net.Conn]struct{}{}}
	srv.ConnState = h.track
	return h
}

func (h *handedServer) track(c net.Conn, state http.ConnState) {
	h.mu.Lock()
	defer h.mu.Unlock()
	switch state {
	case http.StateNew, http.StateActive:
		h.busy[c] = struct{}{}
	default:
		// Idle, closed, or hijacked: a WebSocket is its handler's from then
		// on, and nothing here can wait for it.
		delete(h.busy, c)
	}
}

// serve accepts until the listener is closed, by leave or by Shutdown.
func (h *handedServer) serve() {
	defer close(h.served)
	var err error
	if h.tls {
		err = h.srv.ServeTLS(h.ln, "", "")
	} else {
		err = h.srv.Serve(h.ln)
	}
	if err != nil && !errors.Is(err, http.ErrServerClosed) && !h.leaving.Load() {
		h.log.Error(h.name+" stopped", "err", err)
	}
}

// leave stops accepting, lets the accepted connections finish, and shuts the
// server down, all within ctx.
func (h *handedServer) leave(ctx context.Context) {
	h.leaving.Store(true)
	_ = h.ln.Close()
	select {
	case <-h.served:
	case <-ctx.Done():
	}
	tick := time.NewTicker(2 * time.Millisecond)
	defer tick.Stop()
	for h.busyCount() > 0 {
		select {
		case <-ctx.Done():
			_ = h.srv.Shutdown(ctx)
			return
		case <-tick.C:
		}
	}
	_ = h.srv.Shutdown(ctx)
}

func (h *handedServer) busyCount() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.busy)
}
