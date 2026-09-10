package proxy

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alepha/bay/internal/state"
)

// registered is a DomainRegistry holding exactly the hosts it lists.
type registered map[string]bool

func (r registered) HasDomain(host string) bool { return r[host] }

// notReached fails the test if the redirect hands a request on that it should
// have answered itself.
func notReached(t *testing.T) http.Handler {
	return http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("a registered host reached the router over plain HTTP")
	})
}

// serve sends one request through the redirect and returns the recorder.
func serve(h http.Handler, method, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, target, nil))
	return rec
}

func TestRedirectSendsARegisteredHostToHTTPS(t *testing.T) {
	h := NewHTTPSRedirect(registered{"app.example.com": true}, ":443", notReached(t))

	rec := serve(h, http.MethodGet, "http://app.example.com/docs/intro?lang=fr&page=2")

	if rec.Code != http.StatusPermanentRedirect {
		t.Fatalf("status = %d, want 308", rec.Code)
	}
	// Path and query kept, and no port: 443 is what https:// already means.
	if got, want := rec.Header().Get("Location"), "https://app.example.com/docs/intro?lang=fr&page=2"; got != want {
		t.Errorf("Location = %q, want %q", got, want)
	}
}

func TestRedirectKeepsAPostAPost(t *testing.T) {
	// 308 and not 301: a client replays a 301'd POST as a GET, and the form it
	// was submitting is lost on the way to HTTPS.
	h := NewHTTPSRedirect(registered{"app.example.com": true}, ":443", notReached(t))

	rec := serve(h, http.MethodPost, "http://app.example.com/login")

	if rec.Code != http.StatusPermanentRedirect {
		t.Fatalf("status = %d, want 308", rec.Code)
	}
	if got, want := rec.Header().Get("Location"), "https://app.example.com/login"; got != want {
		t.Errorf("Location = %q, want %q", got, want)
	}
}

func TestRedirectCarriesTheTLSPortWhenItIsNot443(t *testing.T) {
	// The Pebble setup and any non-standard install listen for TLS elsewhere,
	// and a Location without the port would send the browser to a closed 443.
	// The plain-HTTP port the request came in on is not carried over.
	h := NewHTTPSRedirect(registered{"app.example.com": true}, ":8443", notReached(t))

	rec := serve(h, http.MethodGet, "http://app.example.com:8080/a?b=c")

	if got, want := rec.Header().Get("Location"), "https://app.example.com:8443/a?b=c"; got != want {
		t.Errorf("Location = %q, want %q", got, want)
	}
}

func TestRedirectReadsThePortOffAnAddressWithAHost(t *testing.T) {
	for addr, want := range map[string]string{
		"0.0.0.0:443":  "https://app.example.com/",
		"0.0.0.0:8443": "https://app.example.com:8443/",
	} {
		h := NewHTTPSRedirect(registered{"app.example.com": true}, addr, notReached(t))
		if got := serve(h, http.MethodGet, "http://app.example.com/").Header().Get("Location"); got != want {
			t.Errorf("--tls-addr %s: Location = %q, want %q", addr, got, want)
		}
	}
}

func TestRedirectKeepsAnEncodedPathEncoded(t *testing.T) {
	// Decoding %2F on the way would turn one path segment into two, and the app
	// would answer a different URL over HTTPS than the one that was asked for.
	h := NewHTTPSRedirect(registered{"app.example.com": true}, ":443", notReached(t))

	rec := serve(h, http.MethodGet, "http://app.example.com/files/a%2Fb?q=x%20y")

	if got, want := rec.Header().Get("Location"), "https://app.example.com/files/a%2Fb?q=x%20y"; got != want {
		t.Errorf("Location = %q, want %q", got, want)
	}
}

func TestRedirectLeavesAnUnknownHostItsNotFound(t *testing.T) {
	// Redirecting a host no app serves would send the client into a TLS
	// handshake that on-demand issuance refuses. Today's 404 is the better
	// answer, so the router still gives it.
	root := t.TempDir()
	store, err := state.Open(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	router := New(root, store, slog.New(slog.DiscardHandler))
	h := NewHTTPSRedirect(store, ":443", router)

	rec := serve(h, http.MethodGet, "http://stray.example.com/")

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	if rec.Header().Get("Location") != "" {
		t.Errorf("an unknown host was redirected to %q", rec.Header().Get("Location"))
	}
	if !strings.Contains(rec.Body.String(), "no app registered for host stray.example.com") {
		t.Errorf("body = %q, want the router's own 404", rec.Body.String())
	}
}
