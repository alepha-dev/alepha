package proxy

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alepha/bay/internal/state"
)

// freePort returns a port nothing is listening on, and the number to reuse.
func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	_, portStr, _ := net.SplitHostPort(l.Addr().String())
	l.Close()
	port, _ := strconv.Atoi(portStr)
	return port
}

func newTestProxy(t *testing.T) *Proxy {
	t.Helper()
	return New(t.TempDir(), nil, slog.New(slog.DiscardHandler))
}

func TestHeldRequestSurvivesTheAppComingBack(t *testing.T) {
	// The deploy gap: the app is down, the request arrives, and the client must
	// see the answer from the new process rather than a 502.
	port := freePort(t)
	p := newTestProxy(t)
	app := state.App{Name: "demo", Env: "production", Port: port}
	p.HoldFor(app.Key(), 5*time.Second)

	go func() {
		time.Sleep(400 * time.Millisecond)
		l, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
		if err != nil {
			return
		}
		srv := &httptest.Server{
			Listener: l,
			Config: &http.Server{Handler: http.HandlerFunc(
				func(w http.ResponseWriter, r *http.Request) {
					body, _ := io.ReadAll(r.Body)
					w.WriteHeader(http.StatusCreated)
					w.Write(body)
				})},
		}
		srv.Start()
		t.Cleanup(srv.Close)
	}()

	// A POST on purpose: a form submitted during a deploy is exactly what must
	// not be lost, and it only works because a dial failure happens before the
	// body is read.
	req := httptest.NewRequest(http.MethodPost, "/orders", strings.NewReader("payload"))
	rec := httptest.NewRecorder()
	p.forward(rec, req, app)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected the held request to reach the new process, got %d", rec.Code)
	}
	if rec.Body.String() != "payload" {
		t.Fatalf("the body must survive the retry, got %q", rec.Body.String())
	}
}

func TestACrashedAppFailsFastInsteadOfHolding(t *testing.T) {
	// Holding against an app that is not coming back turns one broken app into
	// an exhausted proxy.
	p := newTestProxy(t)
	app := state.App{Name: "dead", Env: "production", Port: freePort(t)}

	start := time.Now()
	rec := httptest.NewRecorder()
	p.forward(rec, httptest.NewRequest(http.MethodGet, "/", nil), app)
	elapsed := time.Since(start)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 when no deploy is in progress, got %d", rec.Code)
	}
	if elapsed > time.Second {
		t.Fatalf("should have failed immediately, took %s", elapsed)
	}
}

func TestHoldEndsWhenTheDeadlinePasses(t *testing.T) {
	// A start that never completes — Bay killed mid-deploy — must not leave
	// requests waiting forever on an app that is never coming.
	p := newTestProxy(t)
	app := state.App{Name: "stuck", Env: "production", Port: freePort(t)}
	p.HoldFor(app.Key(), 150*time.Millisecond)

	start := time.Now()
	rec := httptest.NewRecorder()
	p.forward(rec, httptest.NewRequest(http.MethodGet, "/", nil), app)
	elapsed := time.Since(start)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 once the hold expired, got %d", rec.Code)
	}
	if elapsed > 2*time.Second {
		t.Fatalf("the deadline must be a real backstop, took %s", elapsed)
	}
}

func TestReleaseStopsHoldingImmediately(t *testing.T) {
	p := newTestProxy(t)
	p.HoldFor("demo/production", time.Minute)
	if !p.holding("demo/production") {
		t.Fatal("expected the app to be held")
	}
	p.Release("demo/production")
	if p.holding("demo/production") {
		t.Fatal("Release must take effect at once, not at the deadline")
	}
}

func TestAnErrorFromTheAppIsNotRetried(t *testing.T) {
	// The app was reached. Its answer belongs to the client, error or not —
	// retrying a 500 would hide a real failure behind a hold window.
	var calls atomic.Int32
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := &httptest.Server{
		Listener: l,
		Config: &http.Server{Handler: http.HandlerFunc(
			func(w http.ResponseWriter, _ *http.Request) {
				calls.Add(1)
				w.WriteHeader(http.StatusInternalServerError)
			})},
	}
	srv.Start()
	t.Cleanup(srv.Close)
	_, portStr, _ := net.SplitHostPort(l.Addr().String())
	port, _ := strconv.Atoi(portStr)

	p := newTestProxy(t)
	app := state.App{Name: "angry", Env: "production", Port: port}
	p.HoldFor(app.Key(), time.Minute)

	rec := httptest.NewRecorder()
	p.forward(rec, httptest.NewRequest(http.MethodGet, "/", nil), app)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("the app's own error must reach the client, got %d", rec.Code)
	}
	if n := calls.Load(); n != 1 {
		t.Fatalf("expected exactly one call, got %d", n)
	}
}

func TestAClientThatGivesUpStopsTheHold(t *testing.T) {
	p := newTestProxy(t)
	app := state.App{Name: "slow", Env: "production", Port: freePort(t)}
	p.HoldFor(app.Key(), time.Minute)

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(200 * time.Millisecond)
		cancel()
	}()

	req := httptest.NewRequest(http.MethodGet, "/", nil).WithContext(ctx)
	start := time.Now()
	p.forward(httptest.NewRecorder(), req, app)

	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("a cancelled request must stop waiting, took %s", elapsed)
	}
}

func TestOnlyDialFailuresAreHeld(t *testing.T) {
	if !isDialFailure(&net.OpError{Op: "dial", Err: errors.New("refused")}) {
		t.Error("a refused connection means the app was never reached")
	}
	if isDialFailure(&net.OpError{Op: "read", Err: errors.New("reset")}) {
		t.Error("a read failure means the app was reached and then failed")
	}
	if isDialFailure(io.ErrUnexpectedEOF) {
		t.Error("only dial failures are safe to retry with an unread body")
	}
}
