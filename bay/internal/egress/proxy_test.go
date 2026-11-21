package egress

import (
	"crypto/tls"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
)

// A world of two upstreams, reached by name through the proxy's Dial.
func world(t *testing.T, allow ...string) (*Proxy, *http.Client, *[]Refusal) {
	t.Helper()
	tlsUp := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "tls ok "+r.Host)
	}))
	t.Cleanup(tlsUp.Close)
	plainUp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "plain ok "+r.Host)
	}))
	t.Cleanup(plainUp.Close)

	var mu sync.Mutex
	refused := []Refusal{}
	p := New(allow)
	p.Refused = func(r Refusal) { mu.Lock(); refused = append(refused, r); mu.Unlock() }
	p.Dial = func(network, address string) (net.Conn, error) {
		host, port, _ := net.SplitHostPort(address)
		target := tlsUp.Listener.Addr().String()
		if port == "80" {
			target = plainUp.Listener.Addr().String()
		}
		_ = host
		return net.Dial(network, target)
	}
	proxy := httptest.NewServer(p)
	t.Cleanup(proxy.Close)
	proxyURL, _ := url.Parse(proxy.URL)
	client := &http.Client{Transport: &http.Transport{
		Proxy:           http.ProxyURL(proxyURL),
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // the upstream is the test's own
	}}
	return p, client, &refused
}

func TestProxy(t *testing.T) {
	t.Run("tunnels to a host on the list, without reading inside", func(t *testing.T) {
		_, client, refused := world(t, "api.anthropic.com", ".githubusercontent.com")
		for _, target := range []string{"https://api.anthropic.com/v1/messages", "https://objects.githubusercontent.com/x"} {
			res, err := client.Get(target)
			if err != nil {
				t.Fatalf("%s: %v", target, err)
			}
			body, _ := io.ReadAll(res.Body)
			res.Body.Close()
			if !strings.HasPrefix(string(body), "tls ok") {
				t.Fatalf("%s answered %q", target, body)
			}
		}
		if len(*refused) != 0 {
			t.Fatalf("refused %v", *refused)
		}
	})

	t.Run("refuses a host off the list, and reports it", func(t *testing.T) {
		_, client, refused := world(t, "api.anthropic.com")
		_, err := client.Get("https://evil.example/exfiltrate")
		if err == nil {
			t.Fatal("a host off the list was reached")
		}
		if len(*refused) != 1 || (*refused)[0].Host != "evil.example" || (*refused)[0].Event != "egress.refused" {
			t.Fatalf("refusals = %+v", *refused)
		}
	})

	t.Run("refuses an address literal and a port that is not 80 or 443", func(t *testing.T) {
		p, client, refused := world(t, "api.anthropic.com", "1.1.1.1")
		if _, err := client.Get("https://1.1.1.1/"); err == nil {
			t.Fatal("an IP literal was tunnelled")
		}
		if _, err := client.Get("https://api.anthropic.com:8443/"); err == nil {
			t.Fatal("a port other than 443 was tunnelled")
		}
		if len(*refused) != 2 {
			t.Fatalf("refusals = %+v", *refused)
		}
		if p.Allows("api.anthropic.com.evil.example") || p.Allows("xapi.anthropic.com") {
			t.Fatal("a name that merely contains an entry was allowed")
		}
	})

	t.Run("forwards plain http to a listed host and refuses others", func(t *testing.T) {
		_, client, refused := world(t, "registry.npmjs.org")
		res, err := client.Get("http://registry.npmjs.org/left-pad")
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if !strings.HasPrefix(string(body), "plain ok") {
			t.Fatalf("answered %q", body)
		}
		res, err = client.Get("http://evil.example/")
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusForbidden || len(*refused) != 1 {
			t.Fatalf("status %d, refusals %+v", res.StatusCode, *refused)
		}
	})
}
