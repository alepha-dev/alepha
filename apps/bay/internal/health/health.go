// Package health decides whether an app is actually serving.
//
// The distinction this package exists for: a process that accepts a TCP
// connection is not a process that is ready. An Alepha app binds its port
// before it has run its migrations, so a probe that only dials will call an app
// ready while it is still setting up its database — and Bay will send it
// traffic.
//
// Everything downstream depends on getting this right. Zero-downtime switching
// means knowing when the new release is genuinely serving; automatic rollback
// means knowing when a release has stopped. Both are impossible with a probe
// that cannot tell "listening" from "working".
package health

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"time"
)

// Status is what an app says about itself on /health.
//
// Only `ready` is load-bearing. The rest is reported to the operator, and an
// app that omits any of it is not treated as unhealthy — Bay hosts whatever
// runs, not only apps that speak this dialect.
type Status struct {
	Ready  bool   `json:"ready"`
	Uptime int    `json:"uptime"`
	Date   string `json:"date"`
}

// Probe asks one app how it is.
type Probe struct {
	// Client is reused across checks so keep-alives are not re-established on
	// every poll. Nil is fine; a default is built on first use.
	Client *http.Client
}

func (p *Probe) client() *http.Client {
	if p.Client != nil {
		return p.Client
	}
	p.Client = &http.Client{Timeout: 2 * time.Second}
	return p.Client
}

/*
Check asks `/health` on the loopback port.

Three outcomes, and the caller must be able to tell them apart:

  - (status, true, nil)  — the app answered, and said whether it is ready.
  - (nil, false, nil)    — the app has no /health. Not an error: plenty of
    runtimes do not offer one, and refusing to host them would be wrong.
  - (nil, false, err)    — nothing is listening, or it failed to answer.
*/
func (p *Probe) Check(ctx context.Context, port int) (*Status, bool, error) {
	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	req, err := http.NewRequestWithContext(
		ctx, http.MethodGet, "http://"+addr+"/health", nil,
	)
	if err != nil {
		return nil, false, err
	}

	res, err := p.client().Do(req)
	if err != nil {
		return nil, false, err
	}
	defer res.Body.Close()

	// A 404 means this app does not implement /health, which is a fact about
	// the app rather than a failure of it.
	if res.StatusCode == http.StatusNotFound {
		return nil, false, nil
	}
	if res.StatusCode >= 500 {
		return nil, true, fmt.Errorf("health answered %d", res.StatusCode)
	}

	var status Status
	if err := json.NewDecoder(res.Body).Decode(&status); err != nil {
		// It answered, but not in a shape we understand. Treat that as "no
		// /health" rather than as unhealthy: something is serving on that path,
		// it is simply not this contract.
		return nil, false, nil
	}
	return &status, true, nil
}

/*
WaitReady blocks until the app is serving, or the deadline passes.

Prefers `/health` and requires `ready: true`. Falls back to a TCP dial only
when the app has no `/health` at all — never when it has one and says it is not
ready, because that is precisely the case this exists to catch.
*/
func (p *Probe) WaitReady(port int, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	var lastErr error

	for {
		select {
		case <-ctx.Done():
			if lastErr != nil {
				return fmt.Errorf("timeout after %s: %w", timeout, lastErr)
			}
			return fmt.Errorf("timeout after %s", timeout)
		default:
		}

		status, hasHealth, err := p.Check(ctx, port)
		switch {
		case err != nil:
			lastErr = err
		case hasHealth && status.Ready:
			return nil
		case hasHealth:
			// Listening and explicitly not ready — migrations, warm-up. Keep
			// waiting; this is the whole point.
			lastErr = fmt.Errorf("app reports ready=false")
		default:
			// No /health. The best signal left is that something accepts a
			// connection, which is what Bay did for every app before.
			conn, dialErr := net.DialTimeout("tcp", addr, 500*time.Millisecond)
			if dialErr == nil {
				conn.Close()
				return nil
			}
			lastErr = dialErr
		}

		select {
		case <-ctx.Done():
		case <-time.After(200 * time.Millisecond):
		}
	}
}
