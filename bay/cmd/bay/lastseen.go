package main

import (
	"context"
	"time"
)

// lastSeenFlushInterval is how often accumulated traffic reaches state.json.
//
// Generous on purpose. The question this feeds is "has anything touched this
// app in the last N weeks?", so minutes of precision are already far more than
// the answer can use, and every minute of coarseness is one fewer rewrite of
// the whole state document.
const lastSeenFlushInterval = 5 * time.Minute

/*
flushLastSeenLoop moves the proxy's in-memory traffic record into the store.

Split from the request path so that serving a page never writes to disk: the
store rewrites the entire document with temp-and-rename, and doing that per
request would put a filesystem round trip in front of every asset.

Ticks only. The final drain is NOT done here — cancelling a context merely makes
a goroutine runnable, so a flush on the way out would race `main` returning and
lose whatever it was trying to save. `cmdServe` calls `flushLastSeen` itself,
synchronously, after the proxy has drained.
*/
func (s *server) flushLastSeenLoop(ctx context.Context) {
	ticker := time.NewTicker(lastSeenFlushInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.flushLastSeen()
		}
	}
}

// flushLastSeen persists one batch.
//
// A failure is logged and dropped rather than retried: the batch is already
// gone from the proxy, and re-reading it is not worth a retry queue for a
// timestamp whose only consumer asks about weeks. What must not happen is
// silence — a staleness badge that quietly stops advancing reads exactly like
// an app nobody uses.
func (s *server) flushLastSeen() {
	if s.router == nil {
		return
	}
	for key, at := range s.router.DrainLastSeen() {
		if err := s.store.RecordLastRequest(key, at); err != nil {
			s.log.Error("recording traffic failed", "app", key, "err", err)
		}
	}
}
