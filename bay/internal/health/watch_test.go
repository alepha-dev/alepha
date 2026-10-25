package health

import (
	"context"
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

func watchOn(port int, threshold int, window time.Duration) Verdict {
	return (&Watch{
		Probe:     &Probe{},
		Port:      port,
		Window:    window,
		Interval:  30 * time.Millisecond,
		Threshold: threshold,
	}).Run(context.Background())
}

func TestWatchPassesAHealthyRelease(t *testing.T) {
	port := serveOn(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `{"ready":true}`)
	}))

	verdict := watchOn(port, 3, 300*time.Millisecond)

	if !verdict.Healthy {
		t.Fatalf("a healthy app must pass, got %+v", verdict)
	}
	if verdict.Checks == 0 {
		t.Fatal("a verdict with no checks is not a verdict")
	}
}

func TestWatchCatchesAReleaseThatBootsThenDies(t *testing.T) {
	// The failure a deploy-time check cannot see: the app answers once, is
	// declared ready, and falls over on real traffic.
	var alive atomic.Bool
	alive.Store(true)
	port := serveOn(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if !alive.Load() {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		fmt.Fprint(w, `{"ready":true}`)
	}))

	go func() {
		time.Sleep(60 * time.Millisecond)
		alive.Store(false)
	}()

	verdict := watchOn(port, 3, 3*time.Second)

	if verdict.Healthy {
		t.Fatal("a release that stops serving must be judged unhealthy")
	}
	if verdict.Reason == "" {
		t.Fatal("the operator needs to be told why")
	}
}

func TestWatchToleratesAnIsolatedBlip(t *testing.T) {
	// One timeout during a garbage collection is noise. Rolling back on it is
	// how automatic rollback earns a reputation for making things worse.
	var calls atomic.Int32
	port := serveOn(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) == 2 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		fmt.Fprint(w, `{"ready":true}`)
	}))

	verdict := watchOn(port, 3, 400*time.Millisecond)

	if !verdict.Healthy {
		t.Fatalf("a single blip must not trigger a rollback, got %+v", verdict)
	}
}

func TestWatchDoesNotJudgeAnAppWithoutHealth(t *testing.T) {
	// "Cannot be checked" must never mean "must be rolled back" — Bay hosts
	// whatever runs.
	port := serveOn(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))

	verdict := watchOn(port, 3, 400*time.Millisecond)

	if !verdict.Healthy {
		t.Fatalf("an app with no /health must pass, got %+v", verdict)
	}
}

func TestWatchReturnsAsSoonAsItHasJudged(t *testing.T) {
	// Every second spent watching a release already known to be bad is a
	// second of it being served to users.
	port := serveOn(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))

	start := time.Now()
	verdict := watchOn(port, 2, 10*time.Second)
	elapsed := time.Since(start)

	if verdict.Healthy {
		t.Fatal("expected an unhealthy verdict")
	}
	if elapsed > 2*time.Second {
		t.Fatalf("should have returned on the threshold, took %s", elapsed)
	}
}
