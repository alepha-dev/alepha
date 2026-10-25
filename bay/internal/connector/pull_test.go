package connector

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

const pullSecret = "est_0123456789abcdef0123456789abcdef"

// fakeSink serves the two pull routes for one command, the way Lore does:
// bearer or 401, a digest header beside the bytes, a JSON secret set.
type fakeSink struct {
	srv       *httptest.Server
	bytes     []byte
	header    string
	secrets   string
	artifacts atomic.Int32
	bodyReads atomic.Int32
}

func newFakeSink(t *testing.T, artifact []byte) *fakeSink {
	t.Helper()
	sum := sha256.Sum256(artifact)
	s := &fakeSink{bytes: artifact, header: hex.EncodeToString(sum[:]), secrets: "{}"}
	s.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+pullSecret {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/artifact"):
			s.artifacts.Add(1)
			w.Header().Set(ArtifactDigestHeader, s.header)
			w.Header().Set("content-length", strconv.Itoa(len(s.bytes)))
			w.WriteHeader(http.StatusOK)
			s.bodyReads.Add(1)
			_, _ = w.Write(s.bytes)
		case strings.HasSuffix(r.URL.Path, "/secrets"):
			w.Header().Set("content-type", "application/json")
			_, _ = w.Write([]byte(s.secrets))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(s.srv.Close)
	return s
}

func (s *fakeSink) cfg() Config { return Config{Sink: s.srv.URL, Secret: pullSecret} }

func digestOf(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func TestPullArtifactVerifiesAllThreeDigests(t *testing.T) {
	artifact := []byte("not really a tarball, but bytes with a digest")
	sink := newFakeSink(t, artifact)
	dest := filepath.Join(t.TempDir(), "artifacts", digestOf(artifact)+".tar.gz")
	verified := false
	err := PullArtifact(context.Background(), http.DefaultClient, sink.cfg(), "cmd-1", digestOf(artifact), dest, func() { verified = true })
	if err != nil {
		t.Fatal(err)
	}
	if !verified {
		t.Fatal("the verifying step must be reported")
	}
	got, err := os.ReadFile(dest)
	if err != nil || string(got) != string(artifact) {
		t.Fatalf("dest holds %q, %v", got, err)
	}
	if !ArtifactCached(dest, digestOf(artifact)) {
		t.Fatal("the pulled artifact must read as cached")
	}
	if ArtifactCached(dest, strings.Repeat("0", 64)) {
		t.Fatal("a file under the wrong digest is not a cache hit")
	}
	if entries, _ := os.ReadDir(filepath.Dir(dest)); len(entries) != 1 {
		t.Fatalf("the temp file must not outlive the rename: %v", entries)
	}
}

func TestPullArtifactRefusesASinkOfferingAnotherArtifactBeforeDownloading(t *testing.T) {
	artifact := []byte("bytes")
	sink := newFakeSink(t, artifact)
	dest := filepath.Join(t.TempDir(), "a.tar.gz")
	other := strings.Repeat("a", 64)
	err := PullArtifact(context.Background(), http.DefaultClient, sink.cfg(), "cmd-1", other, dest, nil)
	if err == nil || !strings.Contains(err.Error(), "refusing before download") {
		t.Fatalf("a header naming another artifact must refuse before the body, got %v", err)
	}
	if _, statErr := os.Stat(dest); !os.IsNotExist(statErr) {
		t.Fatal("nothing may land under dest")
	}
}

func TestPullArtifactRefusesBytesThatDoNotMatchAndLeavesNothing(t *testing.T) {
	artifact := []byte("what the sink actually sends")
	sink := newFakeSink(t, artifact)
	// The sink lies in its header: it states the digest the command wants,
	// then sends other bytes.
	want := strings.Repeat("b", 64)
	sink.header = want
	dir := t.TempDir()
	dest := filepath.Join(dir, "artifacts", want+".tar.gz")
	err := PullArtifact(context.Background(), http.DefaultClient, sink.cfg(), "cmd-1", want, dest, nil)
	if err == nil || !strings.Contains(err.Error(), "digest mismatch") {
		t.Fatalf("mismatching bytes must be refused, got %v", err)
	}
	if _, statErr := os.Stat(dest); !os.IsNotExist(statErr) {
		t.Fatal("a rejected artifact must not land under its name")
	}
	entries, _ := os.ReadDir(filepath.Join(dir, "artifacts"))
	if len(entries) != 0 {
		t.Fatalf("a rejected download must leave nothing behind: %v", entries)
	}
}

func TestPullArtifactCarriesTheStatusOfARefusal(t *testing.T) {
	sink := newFakeSink(t, []byte("x"))
	cfg := sink.cfg()
	cfg.Secret = "est_wrong"
	err := PullArtifact(context.Background(), http.DefaultClient, cfg, "cmd-1", strings.Repeat("c", 64), filepath.Join(t.TempDir(), "a"), nil)
	if err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("a refused pull must name the status, got %v", err)
	}
	if err := PullArtifact(context.Background(), http.DefaultClient, sink.cfg(), "cmd-1", "short", filepath.Join(t.TempDir(), "a"), nil); err == nil {
		t.Fatal("a digest that is not a sha256 must be refused before any request")
	}
}

func TestPullSecretsReturnsTheSetOrAnEmptyOne(t *testing.T) {
	sink := newFakeSink(t, []byte("x"))
	set, err := PullSecrets(context.Background(), http.DefaultClient, sink.cfg(), "cmd-1")
	if err != nil || len(set) != 0 {
		t.Fatalf("an empty set must come back empty, got %v, %v", set, err)
	}
	sink.secrets = `{"STRIPE_KEY":"sk_1","OTHER":"v"}`
	set, err = PullSecrets(context.Background(), http.DefaultClient, sink.cfg(), "cmd-1")
	if err != nil || set["STRIPE_KEY"] != "sk_1" || len(set) != 2 {
		t.Fatalf("PullSecrets = %v, %v", set, err)
	}
	sink.secrets = `["not","an","object"]`
	if _, err := PullSecrets(context.Background(), http.DefaultClient, sink.cfg(), "cmd-1"); err == nil {
		t.Fatal("a set that is not an object of strings must be refused")
	}
}
