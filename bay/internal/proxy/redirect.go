package proxy

import (
	"net"
	"net/http"
)

// DomainRegistry answers whether some app is registered for a host.
//
// The state store is the real one. The interface exists so the redirect can
// be tested without laying a release out on disk.
type DomainRegistry interface {
	HasDomain(host string) bool
}

// HTTPSRedirect answers plain HTTP for a registered domain with a 308 to the
// same address over HTTPS, and hands every other request to next.
//
// With --tls on, Bay owns both port 80 and the certificate, so it is the only
// thing that knows HTTPS exists: an app cannot redirect correctly, because it
// cannot tell whether a TLS listener sits in front of it. Before this, port 80
// served every app in cleartext, so anybody who typed the address or followed
// an http:// link got a page anyone on the network path could read and
// rewrite. The app's own HSTS does not cover that visitor: a browser ignores
// the header when it arrives over plain HTTP.
//
// Three choices, each load-bearing:
//
//   - 308, not 301, so a POST stays a POST rather than being replayed as a GET.
//   - An UNREGISTERED host goes to next, which answers today's 404. Redirecting
//     it would send the client into a TLS handshake that on-demand issuance
//     refuses, which is a worse error than the 404.
//   - The Location carries the TLS port when the TLS listener is not on 443:
//     every test setup, and any non-standard install.
//
// It sits INSIDE the ACME challenge handler, never outside it: an HTTP-01
// challenge on port 80 is answered before anything is redirected.
//
// ⚠️ A Cloudflare proxy in Flexible mode talks HTTP to the origin, so it loops
// against this: edge HTTPS, origin port 80, 308 to HTTPS, edge again. Full
// (strict) talks HTTPS to 443 and works. The loop shows up as a browser's "too
// many redirects" and as nothing at all in Bay's logs, which is why INSTALL.md
// says so.
type HTTPSRedirect struct {
	domains DomainRegistry
	// port is empty when the TLS listener is on 443, the port an https:// URL
	// already implies.
	port string
	next http.Handler
}

// NewHTTPSRedirect builds the redirect for a TLS listener bound to tlsAddr, in
// the form --tls-addr takes it (":443", ":8443", "0.0.0.0:443").
func NewHTTPSRedirect(domains DomainRegistry, tlsAddr string, next http.Handler) *HTTPSRedirect {
	port := ""
	if _, p, err := net.SplitHostPort(tlsAddr); err == nil && p != "443" {
		port = p
	}
	return &HTTPSRedirect{domains: domains, port: port, next: next}
}

func (h *HTTPSRedirect) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	host := r.Host
	if name, _, err := net.SplitHostPort(host); err == nil {
		host = name
	}
	if !h.domains.HasDomain(host) {
		h.next.ServeHTTP(w, r)
		return
	}

	authority := host
	if h.port != "" {
		authority = net.JoinHostPort(host, h.port)
	}
	// RequestURI keeps the path and the query exactly as they were sent,
	// percent-encoding included.
	http.Redirect(w, r, "https://"+authority+r.URL.RequestURI(), http.StatusPermanentRedirect)
}
