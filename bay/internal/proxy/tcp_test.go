package proxy

import (
	"bufio"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"net"
	"strconv"
	"testing"
	"time"
)

func echoServer(t *testing.T, prefix string) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				line, _ := bufio.NewReader(c).ReadString('\n')
				c.Write([]byte(prefix + line))
			}()
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port
}

func freeTCPPort(t *testing.T) int {
	ln, _ := net.Listen("tcp", ":0")
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

func roundTrip(t *testing.T, port int, msg string) string {
	t.Helper()
	c, err := net.Dial("tcp", "127.0.0.1:"+strconv.Itoa(port))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.Write([]byte(msg + "\n"))
	line, _ := bufio.NewReader(c).ReadString('\n')
	return line
}

func TestTCPForwarding(t *testing.T) {
	a := echoServer(t, "a:")
	b := echoServer(t, "b:")
	public := freeTCPPort(t)
	fwd := NewTCP(nil)
	defer fwd.Close()

	t.Run("a public port forwards to the service's loopback port", func(t *testing.T) {
		if failed := fwd.Sync(map[int]Forward{public: {Target: a}}); len(failed) != 0 {
			t.Fatal(failed)
		}
		if got := roundTrip(t, public, "hello"); got != "a:hello\n" {
			t.Fatalf("got %q", got)
		}
	})

	t.Run("a moved target is repointed without closing the port", func(t *testing.T) {
		fwd.Sync(map[int]Forward{public: {Target: b}})
		if got := roundTrip(t, public, "again"); got != "b:again\n" {
			t.Fatalf("got %q", got)
		}
	})

	t.Run("a port no longer forwarded is closed", func(t *testing.T) {
		fwd.Sync(nil)
		if fwd.Owns(public) {
			t.Fatal("still owned")
		}
		if err := PortFree(public); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("a port another process holds is reported, not taken", func(t *testing.T) {
		held, _ := net.Listen("tcp", ":0")
		defer held.Close()
		port := held.Addr().(*net.TCPAddr).Port
		if failed := fwd.Sync(map[int]Forward{port: {Target: a}}); failed[port] == nil {
			t.Fatal("expected the busy port to be reported")
		}
	})
}

func selfSigned(t *testing.T, name string) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: name},
		DNSNames: []string{name}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour)}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, pool
}

func TestTCPTerminatesTLS(t *testing.T) {
	cert, pool := selfSigned(t, "mqtt.test")
	target := echoServer(t, "plain:")
	public := freeTCPPort(t)
	fwd := NewTCP(nil)
	defer fwd.Close()
	if failed := fwd.Sync(map[int]Forward{public: {Target: target, TLS: &tls.Config{Certificates: []tls.Certificate{cert}}}}); len(failed) != 0 {
		t.Fatal(failed)
	}
	addr := "127.0.0.1:" + strconv.Itoa(public)

	t.Run("a TLS client reaches the service in plain TCP", func(t *testing.T) {
		c, err := tls.Dial("tcp", addr, &tls.Config{RootCAs: pool, ServerName: "mqtt.test"})
		if err != nil {
			t.Fatal(err)
		}
		defer c.Close()
		c.Write([]byte("hello\n"))
		line, _ := bufio.NewReader(c).ReadString('\n')
		if line != "plain:hello\n" {
			t.Fatalf("got %q", line)
		}
	})

	t.Run("a plaintext client never reaches the service", func(t *testing.T) {
		c, err := net.Dial("tcp", addr)
		if err != nil {
			t.Fatal(err)
		}
		defer c.Close()
		_ = c.SetDeadline(time.Now().Add(2 * time.Second))
		c.Write([]byte("hello\n"))
		line, _ := bufio.NewReader(c).ReadString('\n')
		if line == "plain:hello\n" {
			t.Fatal("a plaintext client got through")
		}
	})
}
