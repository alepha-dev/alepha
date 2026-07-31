package proxy

import (
	"errors"
	"io"
	"net"
	"net/http"
	"sync"
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
	defer p.holds.mu.Unlock()
	if p.holds.until == nil {
		p.holds.until = map[string]time.Time{}
	}
	p.holds.until[key] = time.Now().Add(d)
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
		if err == nil || !isDialFailure(err) || !t.holding() {
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
