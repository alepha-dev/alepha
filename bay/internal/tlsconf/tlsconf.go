// Package tlsconf wires CertMagic in.
//
// Bay writes no TLS or ACME code of its own on purpose: ACME fails *silently*
// and the failure surfaces 90 days later as an expired certificate. CertMagic
// is the library Caddy runs on, and it handles account creation, renewal,
// concurrency, OCSP stapling and Let's Encrypt rate limits.
package tlsconf

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/caddyserver/certmagic"
)

// Options configures certificate management for one Bay instance.
type Options struct {
	// Domains to obtain certificates for.
	Domains []string
	// Email registered with the ACME account (renewal notices).
	Email string
	// CADirectory overrides the ACME directory URL. Empty means Let's Encrypt
	// production. Point it at Pebble for tests, or at LetsEncryptStagingCA
	// before ever touching production — staging has its own, far larger quota.
	CADirectory string
	// TrustedRoots lets the client trust a test CA (Pebble). Never set in
	// production: Pebble's CA private key is public.
	TrustedRoots *x509.CertPool
	// StoragePath is where certificates and the ACME account live.
	StoragePath string
	// HTTPPort / TLSPort move the challenge listeners off 80/443, which is what
	// makes this testable without root.
	HTTPPort int
	TLSPort  int
	// Allow decides whether a hostname may have a certificate issued lazily, at
	// handshake time. This is what makes `*.bay.example.com` work with a single
	// DNS wildcard and no DNS API token: each app gets its own certificate on
	// first request.
	//
	// It is NOT optional. Without it, anyone pointing a DNS name at this machine
	// triggers an issuance attempt, and Let's Encrypt allows only 5 failed
	// validations per hour — a trivial way to lock the whole server out of
	// getting certificates.
	Allow  func(host string) bool
	Logger *slog.Logger
}

// Manager owns the certificate lifecycle.
type Manager struct {
	cfg    *certmagic.Config
	issuer *certmagic.ACMEIssuer
}

// New builds a Manager and synchronously obtains certificates for Domains.
//
// Synchronous on purpose: if a certificate cannot be obtained, the operator
// must find out now, at startup — not from a browser warning in three months.
func New(ctx context.Context, opts Options) (*Manager, error) {
	if len(opts.Domains) == 0 && opts.Allow == nil {
		return nil, fmt.Errorf("nothing to manage: pass Domains, Allow, or both")
	}

	var cfg *certmagic.Config
	cache := certmagic.NewCache(certmagic.CacheOptions{
		GetConfigForCert: func(certmagic.Certificate) (*certmagic.Config, error) {
			return cfg, nil
		},
	})
	cfg = certmagic.New(cache, certmagic.Config{
		Storage: &certmagic.FileStorage{Path: opts.StoragePath},
	})

	issuer := certmagic.NewACMEIssuer(cfg, certmagic.ACMEIssuer{
		CA:             opts.CADirectory,
		Email:          opts.Email,
		Agreed:         true,
		TrustedRoots:   opts.TrustedRoots,
		AltHTTPPort:    opts.HTTPPort,
		AltTLSALPNPort: opts.TLSPort,
	})
	cfg.Issuers = []certmagic.Issuer{issuer}

	if opts.Allow != nil {
		allow := opts.Allow
		cfg.OnDemand = &certmagic.OnDemandConfig{
			DecisionFunc: func(_ context.Context, name string) error {
				if allow(name) {
					return nil
				}
				// Denied hosts must not reach the CA at all, otherwise a stray
				// DNS record burns the failed-validation quota.
				return fmt.Errorf("host %q is not registered with Bay", name)
			},
		}
	}

	// Known domains are obtained eagerly so a restart never makes the first
	// visitor wait. Unknown ones fall through to on-demand issuance.
	//
	// Failure here is loud but NOT fatal: Bay is the reverse proxy, so refusing
	// to start over one app whose DNS is not ready yet would take every other
	// app down with it. Certificates already in storage keep serving, and
	// on-demand retries the rest on the next handshake.
	if len(opts.Domains) > 0 {
		if err := cfg.ManageSync(ctx, opts.Domains); err != nil {
			if opts.Allow == nil {
				return nil, fmt.Errorf("obtain certificates: %w", err)
			}
			if opts.Logger != nil {
				opts.Logger.Error("some certificates could not be obtained at startup; "+
					"on-demand will retry per request", "domains", opts.Domains, "err", err)
			}
		} else if opts.Logger != nil {
			opts.Logger.Info("certificates ready", "domains", opts.Domains)
		}
	}
	return &Manager{cfg: cfg, issuer: issuer}, nil
}

// TLSConfig returns a config whose GetCertificate resolves per SNI.
//
// That callback is why rotating a certificate needs neither a restart nor a
// port handover: a renewal simply changes what the next handshake resolves to.
func (m *Manager) TLSConfig() *tls.Config {
	return m.cfg.TLSConfig()
}

// HTTPChallengeHandler wraps a handler so ACME HTTP-01 challenges are answered
// on the plain-HTTP listener, and everything else falls through to Bay's proxy.
func (m *Manager) HTTPChallengeHandler(next http.Handler) http.Handler {
	return m.issuer.HTTPChallengeHandler(next)
}

// Manage adds domains after startup — what happens when a new app is deployed
// with a domain Bay has never seen.
func (m *Manager) Manage(ctx context.Context, domains []string) error {
	return m.cfg.ManageSync(ctx, domains)
}
