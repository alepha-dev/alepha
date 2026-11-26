package tlsconf

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"testing"
	"time"

	"github.com/caddyserver/certmagic"
)

// TestExpiriesReadTheStore pins #Q4441: the expiry of each served domain comes
// from the certificate CertMagic stored, with no handshake and no CA.
func TestExpiriesReadTheStore(t *testing.T) {
	ctx := context.Background()
	m, err := New(ctx, Options{
		StoragePath: t.TempDir(),
		// No domain obtained at startup, so New reaches no CA.
		Allow:       func(string) bool { return false },
		CADirectory: "https://ca.invalid/directory",
	})
	if err != nil {
		t.Fatal(err)
	}
	notAfter := time.Date(2027, 2, 1, 12, 0, 0, 0, time.UTC)
	store := func(domain string, raw []byte) {
		key := certmagic.StorageKeys.SiteCert(m.issuer.IssuerKey(), domain)
		if err := m.cfg.Storage.Store(ctx, key, raw); err != nil {
			t.Fatal(err)
		}
	}
	store("app.example.com", selfSigned(t, "app.example.com", notAfter))
	store("broken.example.com", []byte("not a certificate"))

	got := m.Expiries(ctx, []string{"app.example.com", "missing.example.com", "broken.example.com"})
	// Self-signed, so the issuer read is the subject's own name.
	if len(got) != 1 {
		t.Fatalf("want one expiry, got %+v", got)
	}
	if got[0].Domain != "app.example.com" || !got[0].NotAfter.Equal(notAfter) || got[0].Issuer != "app.example.com" {
		t.Fatalf("expiry read wrong: %+v", got[0])
	}
}

func selfSigned(t *testing.T, domain string, notAfter time.Time) []byte {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: domain},
		DNSNames:     []string{domain},
		NotBefore:    notAfter.Add(-90 * 24 * time.Hour),
		NotAfter:     notAfter,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}
