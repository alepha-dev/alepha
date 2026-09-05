package connector

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const goodSecret = "est_0123456789abcdef0123456789abcdef"

func TestLoadIsUnconfiguredUntilSet(t *testing.T) {
	store := NewStore(t.TempDir())
	if _, ok, err := store.Load(); err != nil || ok {
		t.Fatalf("a fresh root must dial nobody: ok=%v err=%v", ok, err)
	}
}

func TestSetWritesTheCredentialAtMode0600(t *testing.T) {
	/*
		Asserted structurally, from the mode bits, and not by attempting a
		read as another user: CI runs the container as root, where a
		world-readable file is as readable as any other and a "permission
		denied" test would pass for the wrong reason.
	*/
	store := NewStore(t.TempDir())
	if err := store.Set(Config{Sink: "https://lore.alepha.dev", Secret: goodSecret}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(store.Path())
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != Mode {
		t.Fatalf("credential written at %o, want %o", got, Mode)
	}
	cfg, ok, err := store.Load()
	if err != nil || !ok {
		t.Fatalf("Load after Set: ok=%v err=%v", ok, err)
	}
	if cfg.Sink != "https://lore.alepha.dev" || cfg.Secret != goodSecret {
		t.Fatalf("round trip lost something: %+v", cfg)
	}
	if _, err := os.Stat(store.Path() + ".tmp"); !os.IsNotExist(err) {
		t.Fatalf("the temp file must not outlive the rename")
	}
}

func TestSetReplacesAndDropsTheStaleWelcome(t *testing.T) {
	store := NewStore(t.TempDir())
	if err := store.Set(Config{Sink: "https://one.example", Secret: goodSecret}); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveWelcome(Welcome{Slug: "ovh-1", ReceivedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	if err := store.Set(Config{Sink: "https://two.example", Secret: goodSecret + "x"}); err != nil {
		t.Fatal(err)
	}
	cfg, _, _ := store.Load()
	if cfg.Sink != "https://two.example" {
		t.Fatalf("Set must replace, got %q", cfg.Sink)
	}
	// A different sink or secret is a different estate; the old slug must not
	// be shown beside the new sink.
	if _, ok, _ := store.LoadWelcome(); ok {
		t.Fatal("the welcome of the previous estate survived a new set")
	}
}

func TestClearIsIdempotentAndForgetsTheWelcome(t *testing.T) {
	store := NewStore(t.TempDir())
	if err := store.Clear(); err != nil {
		t.Fatalf("clearing nothing must be fine: %v", err)
	}
	if err := store.Set(Config{Sink: "https://lore.alepha.dev", Secret: goodSecret}); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveWelcome(Welcome{Slug: "ovh-1"}); err != nil {
		t.Fatal(err)
	}
	if err := store.Clear(); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := store.Load(); ok {
		t.Fatal("still configured after clear")
	}
	if _, ok, _ := store.LoadWelcome(); ok {
		t.Fatal("welcome survived clear")
	}
	if err := store.Clear(); err != nil {
		t.Fatalf("second clear: %v", err)
	}
}

func TestSetRefusesASecretOfTheWrongShape(t *testing.T) {
	store := NewStore(t.TempDir())
	for _, secret := range []string{"", "sg_lore_abc", "op_abc", "est_", " " + goodSecret, goodSecret + "\n"} {
		if err := store.Set(Config{Sink: "https://lore.alepha.dev", Secret: secret}); err == nil {
			t.Errorf("secret %q accepted", secret)
		}
	}
	if _, ok, _ := store.Load(); ok {
		t.Fatal("a refused set must write nothing")
	}
}

func TestValidateSinkKeepsTheOriginAndRefusesTheRest(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"https://lore.alepha.dev", "https://lore.alepha.dev"},
		{"https://Lore.Alepha.dev/", "https://lore.alepha.dev"},
		{"  https://lore.alepha.dev:8443 ", "https://lore.alepha.dev:8443"},
		{"http://127.0.0.1:4311", "http://127.0.0.1:4311"},
		{"http://localhost:3303", "http://localhost:3303"},
		{"http://[::1]:3303", "http://[::1]:3303"},
	}
	for _, c := range cases {
		got, err := ValidateSink(c.in)
		if err != nil {
			t.Errorf("ValidateSink(%q): %v", c.in, err)
			continue
		}
		if got != c.want {
			t.Errorf("ValidateSink(%q) = %q, want %q", c.in, got, c.want)
		}
	}

	refused := []string{
		"",
		"lore.alepha.dev",
		"ftp://lore.alepha.dev",
		"https://",
		// Cleartext to anything that is not this machine.
		"http://lore.alepha.dev",
		"http://10.0.0.5:3303",
		"http://192.168.1.10",
		// A page or a token URL pasted by mistake.
		"https://lore.alepha.dev/alepha/settings",
		"https://lore.alepha.dev/?token=x",
		"https://lore.alepha.dev/#estates",
		"https://user:pw@lore.alepha.dev",
	}
	for _, in := range refused {
		if _, err := ValidateSink(in); err == nil {
			t.Errorf("ValidateSink(%q) accepted", in)
		}
	}
}

func TestSocketURLDerivesFromTheSink(t *testing.T) {
	cases := map[string]string{
		"https://lore.alepha.dev":   "wss://lore.alepha.dev/ws/estates",
		"https://lore.example:8443": "wss://lore.example:8443/ws/estates",
		"http://127.0.0.1:4311":     "ws://127.0.0.1:4311/ws/estates",
	}
	for sink, want := range cases {
		if got := SocketURL(sink); got != want {
			t.Errorf("SocketURL(%q) = %q, want %q", sink, got, want)
		}
	}
}

func TestWelcomeRoundTrip(t *testing.T) {
	store := NewStore(t.TempDir())
	at := time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)
	in := Welcome{EstateID: "e1", Slug: "ovh-1", DeployAllowed: true, StatsIntervalSeconds: 300, ReceivedAt: at}
	if err := store.SaveWelcome(in); err != nil {
		t.Fatal(err)
	}
	out, ok, err := store.LoadWelcome()
	if err != nil || !ok {
		t.Fatalf("LoadWelcome: ok=%v err=%v", ok, err)
	}
	if out.Slug != "ovh-1" || !out.DeployAllowed || out.StatsIntervalSeconds != 300 || !out.ReceivedAt.Equal(at) {
		t.Fatalf("round trip lost something: %+v", out)
	}
	// No secret is ever in this file, so a dump of it leaks nothing; the mode
	// is still the credential's, because a world-readable file beside a 0600
	// one invites the wrong copy.
	info, _ := os.Stat(filepath.Join(store.root, WelcomeFileName))
	if got := info.Mode().Perm(); got != Mode {
		t.Fatalf("welcome written at %o, want %o", got, Mode)
	}
}

func TestLoadRefusesAnIncompleteFile(t *testing.T) {
	store := NewStore(t.TempDir())
	if err := os.WriteFile(store.Path(), []byte(`{"sink":"https://lore.alepha.dev"}`), Mode); err != nil {
		t.Fatal(err)
	}
	_, ok, err := store.Load()
	if ok || err == nil || !strings.Contains(err.Error(), "incomplete") {
		t.Fatalf("an incomplete file must be named, got ok=%v err=%v", ok, err)
	}
}

func TestStatusSnapshot(t *testing.T) {
	var nilStatus *Status
	if snap := nilStatus.Snapshot(); snap.Connected {
		t.Fatal("a nil status must read as down")
	}
	st := NewStatus()
	st.Down(errors.New("dial tcp: refused"))
	snap := st.Snapshot()
	if snap.Connected || snap.LastError != "dial tcp: refused" || snap.Since != "" {
		t.Fatalf("after Down: %+v", snap)
	}
	at := time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)
	st.Up(at)
	snap = st.Snapshot()
	if !snap.Connected || snap.Since != "2026-09-05T12:00:00Z" || snap.LastError != "" {
		t.Fatalf("after Up: %+v", snap)
	}
}
