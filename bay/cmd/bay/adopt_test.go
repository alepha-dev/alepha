package main

import (
	"bytes"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/health"
	"github.com/alepha-dev/bay/internal/runner"
	"github.com/alepha-dev/bay/internal/state"
)

// adoptingRunner is the container fake with the Docker runner's Adoptable,
// answering whatever the test decided the daemon would say.
type adoptingRunner struct {
	*imageFakeRunner
	reason string
	asked  []runner.Spec
}

func (a *adoptingRunner) Adoptable(spec runner.Spec) string {
	a.asked = append(a.asked, spec)
	return a.reason
}

// deafTransport is an app that accepts nothing: every probe fails.
type deafTransport struct{}

func (deafTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("connection refused")
}

func adoptFixture(t *testing.T, reason string) (*server, *adoptingRunner, *bytes.Buffer) {
	t.Helper()
	s := runtimesFixture(t, `[{"runtime": "node", "entry": "index.node.js", "runtimeVersion": "26"}]`)
	fake := &adoptingRunner{imageFakeRunner: &imageFakeRunner{fakeRunner: newFakeRunner()}, reason: reason}
	fake.running["api/production"] = true
	var log bytes.Buffer
	s.runner = fake
	s.log = slog.New(slog.NewTextHandler(&log, nil))
	s.probe = &health.Probe{Client: &http.Client{Transport: readyTransport{}}}
	s.adoptTimeout = 200 * time.Millisecond
	return s, fake, &log
}

func TestBootAdoptsOrStarts(t *testing.T) {
	t.Run("a matching container that answers is adopted: no stop, no create", func(t *testing.T) {
		s, fake, log := adoptFixture(t, "")
		s.restoreApps()
		if fake.starts != 0 {
			t.Fatalf("an adoptable app was started %d time(s)", fake.starts)
		}
		if len(fake.asked) != 1 || fake.asked[0].Key != "api/production" {
			t.Fatalf("the runner was asked about %+v", fake.asked)
		}
		if !strings.Contains(log.String(), `msg="app adopted" app=api/production`) {
			t.Fatalf("log = %s", log)
		}
	})

	for _, reason := range []string{runner.NotRunning, runner.NoLabel, runner.SpecChanged, runner.ImageChanged} {
		t.Run("started when the runner says: "+reason, func(t *testing.T) {
			s, fake, log := adoptFixture(t, reason)
			s.restoreApps()
			if fake.starts != 1 {
				t.Fatalf("starts = %d, want 1", fake.starts)
			}
			if !strings.Contains(log.String(), `msg="app started" app=api/production reason="`+reason+`"`) {
				t.Fatalf("the log must say why: %s", log)
			}
		})
	}

	t.Run("a matching container that does not answer is started", func(t *testing.T) {
		s, fake, log := adoptFixture(t, "")
		s.probe = &health.Probe{Client: &http.Client{Transport: deafTransport{}}}
		pending := s.adoptApps()
		if len(pending) != 1 || pending[0].reason != noAnswer {
			t.Fatalf("pending = %+v", pending)
		}
		if fake.starts != 0 {
			t.Fatal("the adopt pass must start nothing")
		}
		// The start itself needs an app that answers, as any start does.
		s.probe = &health.Probe{Client: &http.Client{Transport: readyTransport{}}}
		s.startApps(pending)
		if fake.starts != 1 || !strings.Contains(log.String(), `reason="no answer"`) {
			t.Fatalf("starts = %d, log = %s", fake.starts, log)
		}
	})

	t.Run("the adopt pass starts nothing, so a successor can say it is ready before the starts", func(t *testing.T) {
		s, fake, _ := adoptFixture(t, runner.SpecChanged)
		pending := s.adoptApps()
		if fake.starts != 0 || len(pending) != 1 {
			t.Fatalf("starts = %d, pending = %+v", fake.starts, pending)
		}
	})

	t.Run("a stopped app is neither adopted nor started", func(t *testing.T) {
		s, fake, _ := adoptFixture(t, runner.NotRunning)
		if err := s.store.SetStopped("api/production", true); err != nil {
			t.Fatal(err)
		}
		s.restoreApps()
		if fake.starts != 0 || len(fake.asked) != 0 {
			t.Fatalf("starts = %d, asked = %d", fake.starts, len(fake.asked))
		}
	})

	t.Run("a static site and a Compose service never reach the runner's adoption", func(t *testing.T) {
		s, fake, _ := adoptFixture(t, "")
		for _, app := range []state.App{
			{Name: "site", Env: "production", Static: true},
			{Name: "db", Env: "production", ServiceKind: "service"},
			{Name: "web", Env: "production", ServiceKind: "app"},
		} {
			if got := s.adopt(app); got != notAContainer {
				t.Fatalf("%s: reason = %q", app.Key(), got)
			}
		}
		if len(fake.asked) != 0 {
			t.Fatalf("asked = %+v", fake.asked)
		}
	})

	t.Run("a runner that cannot adopt starts every app, as before", func(t *testing.T) {
		s, _, _ := adoptFixture(t, "")
		plain := &imageFakeRunner{fakeRunner: newFakeRunner()}
		s.runner = plain
		s.log = slog.New(slog.NewTextHandler(io.Discard, nil))
		s.restoreApps()
		if plain.starts != 1 {
			t.Fatalf("starts = %d", plain.starts)
		}
	})
}
