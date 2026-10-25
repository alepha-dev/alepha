package proxy

import "testing"

func TestOperationalPathsAreLoopbackOnly(t *testing.T) {
	// These describe an app's internals — whether it has finished migrating,
	// how full its heap is, how long each route takes. Bay reads them over
	// loopback; on the public host they are a live readout for a stranger.
	for _, path := range []string{"/health", "/healthz", "/metrics"} {
		if !isOperational(path) {
			t.Errorf("%s must not be reachable from the internet", path)
		}
	}
}

func TestAppPathsThatMerelyStartTheSameAreServed(t *testing.T) {
	// The reason this is an exact match and not a prefix: silently 404ing a
	// real page is a worse failure than exposing the two paths it guards.
	for _, path := range []string{
		"/healthcare",
		"/metrics-guide",
		"/health/status",
		"/",
		"/api/health",
	} {
		if isOperational(path) {
			t.Errorf("%s is the app's own page and must be served", path)
		}
	}
}
