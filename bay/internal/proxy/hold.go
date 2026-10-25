package proxy

import (
	"errors"
	"io"
	"net"
	"net/http"
	"sync"
	"syscall"
	"time"
)

/*
Holding requests through a restart is how a deploy stops being an outage.

An app is one process. Replacing it means stopping it and starting the new
release, and between those two moments its port refuses connections — for as
long as the app takes to boot and migrate, which for a real app is seconds.
Every request that arrives in that gap gets a 502. Deploying at any hour of the
day therefore means serving errors to whoever is on the site, which in practice
means deploying at night, which is the opposite of what Bay is for.

The alternative — running the new release alongside the old on a second port
and flipping once it is ready — costs a second copy of the app in memory for
the length of every deploy. On the cheap single VPS Bay is built for, where
each app is capped at 512M, that is how a deploy turns into an OOM kill of
something else. Not worth it to save the few seconds this handles.

So: hold the request instead of failing it. The client sees a slow response
rather than an error, which for a boot measured in seconds is the trade every
operator would make.

Held only while Bay is restarting the app on purpose. An app that crashed and
is not coming back must still fail fast — holding there would pile requests up
against something that will never answer, and turn one broken app into an
exhausted proxy.
*/
type holdSet struct {
	mu    sync.Mutex
	until map[string]time.Time
}

// HoldFor makes requests for this app wait rather than fail, for up to d.
//
// The deadline is a backstop, not the expected path: `Release` is called as
// soon as the app answers. It exists so that a start which never completes —
// the process dies, Bay is killed mid-deploy — cannot leave requests waiting
// on an app that is never coming.
func (p *Proxy) HoldFor(key string, d time.Duration) {
	p.holds.mu.Lock()
	if p.holds.until == nil {
		p.holds.until = map[string]time.Time{}
	}
	p.holds.until[key] = time.Now().Add(d)
	p.holds.mu.Unlock()

	// Drop the pooled connections to every app now, before the one being
	// deployed is stopped.
	//
	// A keep-alive connection sitting idle in the pool is the one hole this
	// otherwise closes: the app destroys it on shutdown, and the next request
	// that picks it up fails with `connection reset by peer` rather than a
	// refused dial — so it is not a retry candidate and becomes a 502. Seen
	// once in 503 requests during a real redeploy.
	//
	// Closing them makes the next request dial fresh, and a fresh dial against
	// a stopped app IS a refused connection, which is held. Costs a handshake
	// on loopback, once per deploy.
	p.transport().CloseIdleConnections()
}

// Release stops holding requests for this app.
func (p *Proxy) Release(key string) {
	p.holds.mu.Lock()
	defer p.holds.mu.Unlock()
	delete(p.holds.until, key)
}

func (p *Proxy) holding(key string) bool {
	p.holds.mu.Lock()
	defer p.holds.mu.Unlock()
	deadline, ok := p.holds.until[key]
	return ok && time.Now().Before(deadline)
}

/*
transport is the shared connection pool to every app.

Its own, not `http.DefaultTransport`: `CloseIdleConnections` is pool-wide, and
calling it on the default transport would also drop connections belonging to
anything else in the process that happens to use it.
*/
func (p *Proxy) transport() *http.Transport {
	p.transportOnce.Do(func() {
		t, _ := http.DefaultTransport.(*http.Transport)
		p.tr = t.Clone()
	})
	return p.tr
}

/*
holdTransport retries a request whose connection was refused.

Safe to retry because a dial failure happens before anything is written: the
request body has not been touched, so the app cannot have seen a partial
request. That is what makes this correct for POST and PUT too, and holding only
idempotent requests would miss the ones that matter — a form submitted during a
deploy is exactly what must not be lost.

Only dial failures. An app that accepted the connection and then failed has
been reached, and its answer — including its error — belongs to the client.
*/
type holdTransport struct {
	base     http.RoundTripper
	holding  func() bool
	interval time.Duration
}

/*
retryable reports whether this failure can be tried again without risk.

A refused dial always can: it happens before a single byte is written, so the
app cannot have seen the request at all. That covers POST and PUT too, which
matters — a form submitted during a deploy is exactly what must not be lost.

A connection RESET is different. The request was written, and Bay cannot tell
whether the app processed it before dying. Retried only when there is no body,
where the method is idempotent by construction and a duplicate costs nothing.
For a POST, a 502 the user can retry themselves is the safer failure than an
order placed twice.
*/
func retryable(err error, req *http.Request) bool {
	if isDialFailure(err) {
		return true
	}
	if req.Body != nil && req.Body != http.NoBody {
		return false
	}
	return isConnectionLoss(err)
}

// isConnectionLoss reports whether the upstream dropped the connection without
// answering — as an app does to its idle sockets when it shuts down.
func isConnectionLoss(err error) bool {
	if errors.Is(err, io.EOF) || errors.Is(err, syscall.ECONNRESET) {
		return true
	}
	var opErr *net.OpError
	return errors.As(err, &opErr) && errors.Is(opErr.Err, syscall.ECONNRESET)
}

func (t holdTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	// The transport closes the request body when a dial fails, which would
	// leave the retry nothing to send. A dial failure happens before a single
	// byte is read, so the original body is still at its start and is perfectly
	// good for the next attempt — it only has to survive being closed.
	//
	// Shielding rather than buffering: buffering means holding every upload in
	// memory for the length of the hold window, which on a 512M app is its own
	// way of taking the site down.
	attempt := req
	if req.Body != nil && req.Body != http.NoBody {
		attempt = req.Clone(req.Context())
		attempt.Body = keptOpen{req.Body}
	}

	for {
		res, err := t.base.RoundTrip(attempt)
		if err == nil || !retryable(err, attempt) || !t.holding() {
			return res, err
		}
		select {
		case <-req.Context().Done():
			// The client gave up. Nothing to serve them.
			return nil, req.Context().Err()
		case <-time.After(t.interval):
		}
	}
}

// keptOpen hides Close from the transport.
//
// The body belongs to the inbound server request, which net/http closes once
// the handler returns. Letting the transport close it early is the only thing
// standing between a refused connection and a retry that can actually send
// what the client sent.
type keptOpen struct{ io.Reader }

func (keptOpen) Close() error { return nil }

// isDialFailure reports whether the request never reached the app.
func isDialFailure(err error) bool {
	var opErr *net.OpError
	if errors.As(err, &opErr) {
		return opErr.Op == "dial"
	}
	return false
}
