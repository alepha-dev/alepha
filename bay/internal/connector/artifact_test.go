package connector

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func digestOf(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func TestFetchStoresAMatchingArtifact(t *testing.T) {
	payload := []byte("a plausible tar.gz")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(payload)
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "artifact.tar.gz")
	if err := Fetch(context.Background(), srv.Client(), srv.URL, "op_test", digestOf(payload), dest); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	stored, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("artifact not stored: %v", err)
	}
	if string(stored) != string(payload) {
		t.Fatal("stored bytes differ from what was served")
	}
}

func TestFetchSendsTheOutpostToken(t *testing.T) {
	payload := []byte("bytes")
	var seen string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r.Header.Get("authorization")
		_, _ = w.Write(payload)
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "artifact.tar.gz")
	if err := Fetch(context.Background(), srv.Client(), srv.URL, "op_test", digestOf(payload), dest); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if seen != "Bearer op_test" {
		t.Fatalf("authorization was %q", seen)
	}
}

// The case the whole function exists for: bytes that are not what the registry
// promised must not reach the name the deploy path will use, and must not be
// left lying around under any name either.
func TestFetchRejectsADigestMismatchAndLeavesNothing(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("not the bytes you were promised"))
	}))
	defer srv.Close()

	dir := t.TempDir()
	dest := filepath.Join(dir, "artifact.tar.gz")
	err := Fetch(context.Background(), srv.Client(), srv.URL, "op_test", strings.Repeat("a", 64), dest)
	if err == nil {
		t.Fatal("expected a digest mismatch")
	}
	if !strings.Contains(err.Error(), "mismatch") {
		t.Fatalf("error should name the mismatch, got: %v", err)
	}

	if _, statErr := os.Stat(dest); !os.IsNotExist(statErr) {
		t.Fatal("a rejected artifact must not carry the destination name")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("temporary file left behind: %v", entries)
	}
}

func TestFetchRefusesAMalformedDigestBeforeCalling(t *testing.T) {
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "artifact.tar.gz")
	if err := Fetch(context.Background(), srv.Client(), srv.URL, "op_test", "NOTADIGEST", dest); err == nil {
		t.Fatal("expected a refusal")
	}
	if called {
		t.Fatal("a malformed digest must be refused without spending a request")
	}
}

func TestFetchSurfacesAnHttpError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"message":"No such release claimed by this outpost"}`))
	}))
	defer srv.Close()

	dest := filepath.Join(t.TempDir(), "artifact.tar.gz")
	err := Fetch(context.Background(), srv.Client(), srv.URL, "op_test", strings.Repeat("a", 64), dest)
	if err == nil {
		t.Fatal("expected an error")
	}
	// The sink's own sentence is what says what to do; swallowing it would
	// leave an operator with a status code and nothing else.
	if !strings.Contains(err.Error(), "No such release claimed") {
		t.Fatalf("error should carry the sink's message, got: %v", err)
	}
}
