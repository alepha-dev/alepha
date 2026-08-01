package proxy

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/alepha/bay/internal/state"
)

func TestLastSeenDrainReportsThenForgets(t *testing.T) {
	// The proxy accumulates in memory and a ticker drains it, so the request
	// path never touches the disk. Draining twice must not re-report: the
	// second flush would rewrite state.json for apps that saw no traffic, and
	// the write rate would track the ticker instead of the traffic.
	var seen lastSeen
	at := time.Unix(1700000000, 0)

	seen.touch("lore/production", at)
	seen.touch("demo/staging", at)

	first := seen.drain()
	if len(first) != 2 {
		t.Fatalf("expected both apps in the first drain, got %v", first)
	}
	if !first["lore/production"].Equal(at) {
		t.Fatalf("wrong timestamp carried through: %v", first["lore/production"])
	}

	if second := seen.drain(); len(second) != 0 {
		t.Fatalf("a second drain with no traffic must be empty, got %v", second)
	}
}

func TestLastSeenKeepsTheNewestOfABatch(t *testing.T) {
	// Many requests land between two ticks. Only the most recent matters, and
	// keeping the first would make a busy app look progressively staler.
	var seen lastSeen
	at := time.Unix(1700000000, 0)

	seen.touch("lore/production", at)
	seen.touch("lore/production", at.Add(30*time.Second))
	seen.touch("lore/production", at.Add(10*time.Second))

	got := seen.drain()
	if !got["lore/production"].Equal(at.Add(30 * time.Second)) {
		t.Fatalf("the newest stamp of the batch must win, got %v", got["lore/production"])
	}
}

/*
countsAsTraffic is the whole point of this file, so it gets the most tests.

Every domain Bay serves is publicly enumerable: Let's Encrypt publishes each
certificate it issues to the Certificate Transparency logs, so a prototype
nobody has ever shared is in a public list within minutes of getting HTTPS, and
it WILL be scanned. Counting raw requests would therefore show every abandoned
app as freshly used, which is precisely the reading the badge exists to prevent.

The rule: a request counts when the app actually answered it. A scanner probing
/wp-login.php gets a 404 and does not move the needle; someone loading the page
gets a 200 and does.
*/
// backendReturning starts an app that answers everything with one status, and
// returns the port to point a state.App at.
func backendReturning(t *testing.T, status int) int {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
	}))
	t.Cleanup(srv.Close)
	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		t.Fatal(err)
	}
	return port
}

/*
The rule above is only worth anything if it is actually consulted, and the way
it gets consulted is easy to lose: it hangs off `ModifyResponse`, a field on a
reverse proxy built fresh for every request. Delete that assignment and every
unit test in this file still passes while nothing is ever recorded again.

So this one goes through the real forward path, against a real backend.
*/
func TestForwardRecordsOnlyRequestsTheAppAnswered(t *testing.T) {
	cases := []struct {
		name   string
		status int
		want   bool
	}{
		{"a served page is recorded", http.StatusOK, true},
		{"a scanner collecting 404s is not", http.StatusNotFound, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := newTestProxy(t)
			app := state.App{Name: "demo", Env: "production", Port: backendReturning(t, tc.status)}

			p.forward(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil), app)

			_, recorded := p.DrainLastSeen()[app.Key()]
			if recorded != tc.want {
				t.Fatalf("a %d response recorded=%v, want %v", tc.status, recorded, tc.want)
			}
		})
	}
}

func TestCountsAsTraffic(t *testing.T) {
	cases := []struct {
		name   string
		status int
		want   bool
	}{
		{"a served page", 200, true},
		{"a conditional request from a returning visitor", 304, true},
		{"a redirect the app chose to issue", 302, true},
		// The upgrade handshake for a websocket. Someone is connecting.
		{"a protocol switch", 101, true},
		// Scanner territory. The app was reached, and it said there is nothing
		// here — which is exactly what it says to a bot walking a wordlist.
		{"a probe for a path that does not exist", 404, false},
		{"a probe for something forbidden", 403, false},
		{"an unauthenticated poke at an API", 401, false},
		// A 500 means the app is broken, not that it is being used. Counting it
		// would make a crash-looping app look healthiest of all.
		{"an app erroring", 500, false},
		{"the proxy's own bad gateway", 502, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := countsAsTraffic(tc.status); got != tc.want {
				t.Fatalf("countsAsTraffic(%d) = %v, want %v", tc.status, got, tc.want)
			}
		})
	}
}
