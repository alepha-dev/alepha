package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// knownHosts is a proxy.DomainRegistry holding exactly the hosts it lists.
type knownHosts map[string]bool

func (k knownHosts) HasDomain(host string) bool { return k[host] }

// teapot stands in for the router, answering with a status nothing else uses
// so a test can tell it answered.
var teapot = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusTeapot)
})

// fakeChallenge answers an ACME HTTP-01 challenge path the way CertMagic's
// handler does, and passes everything else on.
func fakeChallenge(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/.well-known/acme-challenge/") {
			_, _ = w.Write([]byte("key-authorization"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func plainGet(h http.Handler, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

func TestPortEightyWithoutTLSIsTheRouterAlone(t *testing.T) {
	// A local run, or Bay behind another terminator that talks HTTP to it:
	// there is no HTTPS here to send anyone to, and a redirect would loop.
	h := portEighty(teapot, nil, knownHosts{"app.example.com": true}, ":443")

	rec := plainGet(h, "http://app.example.com/page")

	if rec.Code != http.StatusTeapot {
		t.Fatalf("status = %d, want the router's own answer", rec.Code)
	}
	if loc := rec.Header().Get("Location"); loc != "" {
		t.Errorf("redirected to %q without TLS", loc)
	}
}

func TestPortEightyAnswersTheChallengeBeforeRedirecting(t *testing.T) {
	// The CA validates HTTP-01 on port 80. Redirected first, issuance would
	// depend on the CA following a 308 into a TLS listener whose certificate
	// is the very thing being issued.
	h := portEighty(teapot, fakeChallenge, knownHosts{"app.example.com": true}, ":443")

	rec := plainGet(h, "http://app.example.com/.well-known/acme-challenge/token")

	if rec.Code != http.StatusOK || rec.Body.String() != "key-authorization" {
		t.Fatalf("challenge: status %d, body %q; want 200 and the key authorization", rec.Code, rec.Body.String())
	}
}

func TestPortEightyRedirectsARegisteredHostWithTLS(t *testing.T) {
	h := portEighty(teapot, fakeChallenge, knownHosts{"app.example.com": true}, ":443")

	rec := plainGet(h, "http://app.example.com/page?x=1")

	if rec.Code != http.StatusPermanentRedirect {
		t.Fatalf("status = %d, want 308", rec.Code)
	}
	if got, want := rec.Header().Get("Location"), "https://app.example.com/page?x=1"; got != want {
		t.Errorf("Location = %q, want %q", got, want)
	}
}

func TestPortEightyLeavesAnUnknownHostToTheRouterWithTLS(t *testing.T) {
	h := portEighty(teapot, fakeChallenge, knownHosts{"app.example.com": true}, ":443")

	rec := plainGet(h, "http://stray.example.com/")

	if rec.Code != http.StatusTeapot {
		t.Fatalf("status = %d, want the router's own answer for a host no app serves", rec.Code)
	}
}
