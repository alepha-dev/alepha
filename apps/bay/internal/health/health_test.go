package health

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// serveOn starts a server on a free loopback port and returns the port.
func serveOn(t *testing.T, handler http.Handler) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := &httptest.Server{
		Listener: listener,
		Config:   &http.Server{Handler: handler},
	}
	srv.Start()
	t.Cleanup(srv.Close)

	_, portStr, _ := net.SplitHostPort(listener.Addr().String())
	port, _ := strconv.Atoi(portStr)
	return port
}

func TestWaitReadyAcceptsAReadyApp(t *testing.T) {
	port := serveOn(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `{"ready":true,"uptime":3}`)
	}))

	if err := (&Probe{}).WaitReady(port, 2*time.Second); err != nil {
		t.Fatalf("expected ready, got %v", err)
	}
}

func TestWaitReadyRefusesAnAppThatIsListeningButNotReady(t *testing.T) {
	// The bug this package exists for. An Alepha app binds its port before it
	// has run migrations; the old TCP-only probe called that ready and Bay sent
	// it traffic.
	port := serveOn(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `{"ready":false}`)
	}))

	err := (&Probe{}).WaitReady(port, 600*time.Millisecond)
	if err == nil {
		t.Fatal("a listening-but-not-ready app must not pass")
	}
	if !strings.Contains(err.Error(), "ready=false") {
		t.Fatalf("the error should name the cause, got %v", err)
	}
}

func TestWaitReadyPassesOnceTheAppFlipsToReady(t *testing.T) {
	var ready atomic.Bool
	port := serveOn(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintf(w, `{"ready":%t}`, ready.Load())
	}))

	go func() {
		time.Sleep(300 * time.Millisecond)
		ready.Store(true)
	}()

	if err := (&Probe{}).WaitReady(port, 3*time.Second); err != nil {
		t.Fatalf("expected it to wait then pass, got %v", err)
	}
}

func TestWaitReadyFallsBackToTcpForAnAppWithoutHealth(t *testing.T) {
	// Bay hosts whatever runs. An app with no /health is not a broken app, and
	// refusing to start it would make Bay useless for anything but Alepha.
	port := serveOn(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))

	if err := (&Probe{}).WaitReady(port, 2*time.Second); err != nil {
		t.Fatalf("expected the TCP fallback to accept it, got %v", err)
	}
}

func TestWaitReadyFallsBackWhenHealthIsNotThisContract(t *testing.T) {
	// Something serves /health, but it is not our shape — a static site with a
	// page at that path, say. Same treatment as no /health at all.
	port := serveOn(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `<html>health</html>`)
	}))

	if err := (&Probe{}).WaitReady(port, 2*time.Second); err != nil {
		t.Fatalf("expected the TCP fallback, got %v", err)
	}
}

func TestWaitReadyFailsWhenNothingListens(t *testing.T) {
	// Port 1 is privileged and never bound by an app.
	if err := (&Probe{}).WaitReady(1, 400*time.Millisecond); err == nil {
		t.Fatal("expected a failure when nothing is listening")
	}
}

func TestCheckDistinguishesAbsentHealthFromUnhealthy(t *testing.T) {
	absent := serveOn(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	broken := serveOn(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))

	probe := &Probe{}

	_, hasHealth, err := probe.Check(context.Background(), absent)
	if hasHealth || err != nil {
		t.Fatalf("a 404 means no /health, not a failure: has=%v err=%v", hasHealth, err)
	}

	// A 5xx is the opposite: the endpoint exists and the app is in trouble.
	// Collapsing the two would make a crashing app look like a plain one.
	_, hasHealth, err = probe.Check(context.Background(), broken)
	if !hasHealth || err == nil {
		t.Fatalf("a 5xx means unhealthy: has=%v err=%v", hasHealth, err)
	}
}
