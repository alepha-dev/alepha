package main

import (
	"net/http"

	"github.com/alepha/bay/internal/proxy"
)

// portEighty is what the plain-HTTP listener serves.
//
// Without TLS (challenge is nil) it is the router, exactly as it always was:
// a local run, or Bay behind another terminator that talks HTTP to it, has no
// HTTPS of its own to send anybody to, and a redirect there would loop.
//
// With TLS, the ACME challenge handler goes OUTSIDE the redirect, so an HTTP-01
// challenge is answered on port 80 before anything is sent to HTTPS, and every
// other request for a registered domain gets a 308. A host no app serves falls
// through to the router and its 404. See proxy.HTTPSRedirect.
func portEighty(router http.Handler, challenge func(http.Handler) http.Handler, domains proxy.DomainRegistry, tlsAddr string) http.Handler {
	if challenge == nil {
		return router
	}
	return challenge(proxy.NewHTTPSRedirect(domains, tlsAddr, router))
}
