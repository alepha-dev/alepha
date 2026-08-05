package proxy

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/alepha/bay/internal/state"
)

// appEchoingHeader starts a stand-in app on port that reports one request
// header back to the caller.
func appEchoingHeader(t *testing.T, port int, header string) {
	t.Helper()
	l, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		t.Fatal(err)
	}
	srv := &httptest.Server{
		Listener: l,
		Config: &http.Server{Handler: http.HandlerFunc(
			func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("X-Seen", r.Header.Get(header))
				w.WriteHeader(http.StatusOK)
			})},
	}
	srv.Start()
	t.Cleanup(srv.Close)
}

/*
Bay is the proxy Alepha's router already asks for.

`ServerRouterProvider.getContextId` reads `x-request-id` (then
`x-correlation-id`) and falls back to a fresh UUID, with a comment recommending
"a proxy that sets a consistent request ID header for better traceability across
services". Bay is that proxy and was not setting one — so every app minted its
own id and nothing on the Bay side could be joined to it.

Setting it costs one header and needs no change in the framework: the id Bay
puts on the request is the `context` field of every log line the app writes for
it, and the `requestId` in any error body it returns.
*/
func TestProxyGivesEveryRequestAnId(t *testing.T) {
	port := freePort(t)
	appEchoingHeader(t, port, "X-Request-Id")
	p := newTestProxy(t)
	app := appAt(port)

	req := httptest.NewRequest(http.MethodGet, "/orders", nil)
	rec := httptest.NewRecorder()
	p.forward(rec, req, app)

	if got := rec.Header().Get("X-Seen"); got == "" {
		t.Fatal("the app received no X-Request-Id; Bay must mint one")
	}
}

func TestEachRequestGetsItsOwnId(t *testing.T) {
	// A constant would be worse than nothing: every log line in the fleet would
	// share one id and joining them would return everything.
	port := freePort(t)
	appEchoingHeader(t, port, "X-Request-Id")
	p := newTestProxy(t)
	app := appAt(port)

	seen := map[string]bool{}
	for range 3 {
		rec := httptest.NewRecorder()
		p.forward(rec, httptest.NewRequest(http.MethodGet, "/orders", nil), app)
		seen[rec.Header().Get("X-Seen")] = true
	}
	if len(seen) != 3 {
		t.Fatalf("expected 3 distinct ids, got %v", seen)
	}
}

func TestAClientCannotChooseItsOwnRequestId(t *testing.T) {
	/*
		Overwritten, never trusted — the same rule `X-Forwarded-Proto` follows
		two lines above it, and for the same reason.

		`getContextId` says "we trust these headers as all our environments are
		behind a proxy". That sentence is only true if the proxy actually sets
		them. Left to pass through, any client could pin every one of its
		requests to one id, or reuse somebody else's, and the field an operator
		greps by would be attacker-chosen.
	*/
	port := freePort(t)
	appEchoingHeader(t, port, "X-Request-Id")
	p := newTestProxy(t)
	app := appAt(port)

	req := httptest.NewRequest(http.MethodGet, "/orders", nil)
	req.Header.Set("X-Request-Id", "chosen-by-the-client")
	rec := httptest.NewRecorder()
	p.forward(rec, req, app)

	if got := rec.Header().Get("X-Seen"); got == "chosen-by-the-client" {
		t.Fatal("a client-supplied request id must not reach the app")
	}
}

// appAt is the registered instance these tests forward to.
func appAt(port int) state.App {
	return state.App{Name: "demo", Env: "production", Port: port}
}
