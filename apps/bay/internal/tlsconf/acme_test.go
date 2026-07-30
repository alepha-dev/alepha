package tlsconf

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// TestIssuesRealCertificateViaACME drives the full RFC 8555 dance against
// Pebble — Let's Encrypt's own test server.
//
// This is the only way to know the ACME path works before a real domain is
// involved: it exercises account creation, order, challenge and issuance, and
// it catches the class of bug that otherwise stays invisible for 90 days.
//
// Skipped unless pebble and pebble-challtestsrv are on PATH (or BAY_PEBBLE_BIN
// points at them), so `go test ./...` stays green on a bare checkout.
func TestIssuesRealCertificateViaACME(t *testing.T) {
	pebbleBin := lookBinary(t, "pebble")
	challBin := lookBinary(t, "pebble-challtestsrv")
	if pebbleBin == "" || challBin == "" {
		t.Skip("pebble / pebble-challtestsrv not found; see README for install")
	}

	dir := t.TempDir()

	// Pebble serves its own ACME API over HTTPS, so it needs a certificate.
	// Generating it here keeps the test self-contained — no files borrowed from
	// the pebble repository.
	caCert, caKey := makeCA(t)
	writePEM(t, filepath.Join(dir, "ca.pem"), "CERTIFICATE", caCert.Raw)
	serverCert, serverKey := makeServerCert(t, caCert, caKey, "localhost")
	writePEM(t, filepath.Join(dir, "pebble.pem"), "CERTIFICATE", serverCert.Raw)
	writeKey(t, filepath.Join(dir, "pebble.key"), serverKey)

	// Challenges are validated on high ports, so nothing here needs root.
	const (
		httpChallengePort = 5002
		tlsChallengePort  = 5001
		acmeDirPort       = 14000
		dnsPort           = 8053
	)
	cfgPath := filepath.Join(dir, "pebble-config.json")
	writeJSON(t, cfgPath, map[string]any{
		"pebble": map[string]any{
			"listenAddress":           fmt.Sprintf("127.0.0.1:%d", acmeDirPort),
			"managementListenAddress": "127.0.0.1:15000",
			"certificate":             filepath.Join(dir, "pebble.pem"),
			"privateKey":              filepath.Join(dir, "pebble.key"),
			"httpPort":                httpChallengePort,
			"tlsPort":                 tlsChallengePort,
			"ocspResponderURL":        "",
		},
	})

	// challtestsrv answers every A query with 127.0.0.1 so the test domain
	// resolves back to us. Its own challenge servers are disabled — Bay must be
	// the one answering, otherwise the test proves nothing.
	chall := run(t, challBin,
		"-dnsserver", fmt.Sprintf(":%d", dnsPort),
		"-http01", "", "-https01", "", "-tlsalpn01", "",
		"-doh", "", "-management", ":8055",
	)
	defer stop(chall)
	waitPort(t, dnsPort, "udp")

	pebble := run(t, pebbleBin,
		"-config", cfgPath,
		"-dnsserver", fmt.Sprintf("127.0.0.1:%d", dnsPort),
	)
	defer stop(pebble)
	waitPort(t, acmeDirPort, "tcp")

	roots := x509.NewCertPool()
	roots.AddCert(caCert)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	const domain = "bay-poc.test"
	mgr, err := New(ctx, Options{
		Domains:      []string{domain},
		Email:        "bay@example.test",
		CADirectory:  fmt.Sprintf("https://127.0.0.1:%d/dir", acmeDirPort),
		TrustedRoots: roots,
		StoragePath:  filepath.Join(dir, "certmagic"),
		HTTPPort:     httpChallengePort,
		TLSPort:      tlsChallengePort,
	})
	if err != nil {
		t.Fatalf("ACME issuance failed: %v", err)
	}

	// A certificate that exists is not the same as a certificate that serves.
	// Resolve it the way a real handshake would.
	tlsCfg := mgr.TLSConfig()
	cert, err := tlsCfg.GetCertificate(&tls.ClientHelloInfo{
		ServerName:        domain,
		SupportedProtos:   []string{"h2", "http/1.1"},
		SupportedVersions: []uint16{tls.VersionTLS13},
		CipherSuites:      []uint16{tls.TLS_AES_128_GCM_SHA256},
	})
	if err != nil {
		t.Fatalf("no certificate resolved for %s: %v", domain, err)
	}
	leaf, err := x509.ParseCertificate(cert.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	if err := leaf.VerifyHostname(domain); err != nil {
		t.Fatalf("certificate does not cover %s: %v", domain, err)
	}
	if leaf.NotAfter.Before(time.Now()) {
		t.Fatal("certificate is already expired")
	}
	t.Logf("issued by %q for %v, valid until %s",
		leaf.Issuer.CommonName, leaf.DNSNames, leaf.NotAfter.Format(time.RFC3339))
}

// --- helpers ---------------------------------------------------------------

func lookBinary(t *testing.T, name string) string {
	t.Helper()
	if dir := os.Getenv("BAY_PEBBLE_BIN"); dir != "" {
		p := filepath.Join(dir, name)
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	p, err := exec.LookPath(name)
	if err != nil {
		return ""
	}
	return p
}

func run(t *testing.T, bin string, args ...string) *exec.Cmd {
	t.Helper()
	cmd := exec.Command(bin, args...)
	var out testWriter = testWriter{t: t, prefix: filepath.Base(bin)}
	cmd.Stdout, cmd.Stderr = out, out
	if err := cmd.Start(); err != nil {
		t.Fatalf("start %s: %v", bin, err)
	}
	return cmd
}

func stop(cmd *exec.Cmd) {
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}
}

type testWriter struct {
	t      *testing.T
	prefix string
}

func (w testWriter) Write(p []byte) (int, error) {
	w.t.Logf("[%s] %s", w.prefix, p)
	return len(p), nil
}

func waitPort(t *testing.T, port int, network string) {
	t.Helper()
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if network == "udp" {
			// A UDP listener cannot be probed by connecting; give it a moment.
			time.Sleep(300 * time.Millisecond)
			return
		}
		conn, err := net.DialTimeout("tcp", addr, 300*time.Millisecond)
		if err == nil {
			conn.Close()
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("%s never opened %s", network, addr)
}

func makeCA(t *testing.T) (*x509.Certificate, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "bay test CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return cert, key
}

func makeServerCert(t *testing.T, ca *x509.Certificate, caKey *ecdsa.PrivateKey, host string) (*x509.Certificate, *ecdsa.PrivateKey) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: host},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     []string{host},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, ca, &key.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return cert, key
}

func writePEM(t *testing.T, path, blockType string, der []byte) {
	t.Helper()
	buf := pem.EncodeToMemory(&pem.Block{Type: blockType, Bytes: der})
	if err := os.WriteFile(path, buf, 0o600); err != nil {
		t.Fatal(err)
	}
}

func writeKey(t *testing.T, path string, key *ecdsa.PrivateKey) {
	t.Helper()
	der, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	writePEM(t, path, "EC PRIVATE KEY", der)
}

func writeJSON(t *testing.T, path string, body any) {
	t.Helper()
	raw, err := json.MarshalIndent(body, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
}
