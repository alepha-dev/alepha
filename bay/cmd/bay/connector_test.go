package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/connector"
	"github.com/alepha-dev/bay/internal/state"
)

const testSecret = "est_0123456789abcdef0123456789abcdef"

// servedRoot is a directory `bay serve` has run from: it holds a state.json.
func servedRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if _, err := state.Open(filepath.Join(root, "state.json")); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestConnectorRootRefusesADirectoryNoBayServesFrom(t *testing.T) {
	/*
		The operator mistake this guards: `bay connector set` run from a home
		directory used to create a fresh ./bay-data there, write the secret
		into it and print success, while the running Bay was rooted under
		/opt and never read it.
	*/
	empty := t.TempDir()
	_, err := connectorRoot([]string{"--root", empty})
	if err == nil {
		t.Fatal("a root with no state.json must be refused")
	}
	for _, want := range []string{"not a Bay root", "state.json", "--root"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q does not mention %q", err, want)
		}
	}
}

func TestConnectorRootAcceptsAServedRoot(t *testing.T) {
	root := servedRoot(t)
	got, err := connectorRoot([]string{"--root", root})
	if err != nil || got != root {
		t.Fatalf("connectorRoot = %q, %v; want %q", got, err, root)
	}
}

func TestConnectorRootReadsBayRoot(t *testing.T) {
	root := servedRoot(t)
	t.Setenv("BAY_ROOT", root)
	got, err := connectorRoot(nil)
	if err != nil || got != root {
		t.Fatalf("connectorRoot from $BAY_ROOT = %q, %v; want %q", got, err, root)
	}
}

func TestConnectorSetPersistsAndNeverEchoesTheSecret(t *testing.T) {
	root := servedRoot(t)
	store := connector.NewStore(root)
	var out bytes.Buffer
	if err := connectorSet(store, []string{"https://lore.alepha.dev", testSecret}, &out); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.String(), testSecret[4:]) {
		t.Fatalf("set echoed the secret:\n%s", out.String())
	}
	if !strings.Contains(out.String(), "wss://lore.alepha.dev/ws/estates") {
		t.Fatalf("set should say where it will dial:\n%s", out.String())
	}
	info, err := os.Stat(store.Path())
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != connector.Mode {
		t.Fatalf("credential written at %o, want %o", got, connector.Mode)
	}
}

func TestConnectorSetRefusesACleartextSinkOffTheMachine(t *testing.T) {
	root := servedRoot(t)
	store := connector.NewStore(root)
	err := connectorSet(store, []string{"http://lore.alepha.dev", testSecret}, &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "cleartext") {
		t.Fatalf("a public http:// sink must be refused, got %v", err)
	}
	if err := connectorSet(store, []string{"http://127.0.0.1:4311", testSecret}, &bytes.Buffer{}); err != nil {
		t.Fatalf("a loopback http:// sink is what the e2e runs against: %v", err)
	}
	if _, ok, _ := store.Load(); !ok {
		t.Fatal("the loopback sink was not stored")
	}
}

func TestConnectorSetWantsExactlyTwoArguments(t *testing.T) {
	store := connector.NewStore(servedRoot(t))
	if err := connectorSet(store, []string{"https://lore.alepha.dev"}, &bytes.Buffer{}); err == nil {
		t.Fatal("a missing secret must be refused")
	}
	if err := connectorSet(store, positionals([]string{"https://lore.alepha.dev", testSecret, "--root", "/x"}), &bytes.Buffer{}); err != nil {
		t.Fatalf("flags must not count as positionals: %v", err)
	}
}

func TestConnectorShowNeverPrintsTheSecret(t *testing.T) {
	/*
		No `bay serve` answers in a test, so the connection line says no
		control socket was found, which is the honest answer: the other lines
		come from the file and the cached welcome, and none of them may carry
		the secret, in whole or in part.
	*/
	installerLayout(t)
	root := servedRoot(t)
	store := connector.NewStore(root)
	if err := store.Set(connector.Config{Sink: "https://lore.alepha.dev", Secret: testSecret}); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveWelcome(connector.Welcome{Slug: "ovh-1", DeployAllowed: true, StatsIntervalSeconds: 300, ReceivedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := connectorShow(store, &out); err != nil {
		t.Fatal(err)
	}
	text := out.String()
	for _, want := range []string{"https://lore.alepha.dev", "ovh-1", "deploys allowed", "300s", "no control socket"} {
		if !strings.Contains(text, want) {
			t.Errorf("show is missing %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "est_") {
		t.Fatalf("show printed the secret, or part of it:\n%s", text)
	}
}

func TestConnectorShowUnconfigured(t *testing.T) {
	var out bytes.Buffer
	if err := connectorShow(connector.NewStore(servedRoot(t)), &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "dials nobody") {
		t.Fatalf("an unconfigured connector must say so:\n%s", out.String())
	}
}

func TestConnectorClearForgetsEverything(t *testing.T) {
	root := servedRoot(t)
	store := connector.NewStore(root)
	if err := store.Set(connector.Config{Sink: "https://lore.alepha.dev", Secret: testSecret}); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveWelcome(connector.Welcome{Slug: "ovh-1"}); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := connectorClear(store, &out); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := store.Load(); ok {
		t.Fatal("still configured after clear")
	}
	if _, ok, _ := store.LoadWelcome(); ok {
		t.Fatal("the welcome survived clear")
	}
	if !strings.Contains(out.String(), "dials nobody") {
		t.Fatalf("clear must say the machine now dials nobody:\n%s", out.String())
	}
}

func TestControlConnectorReportCarriesNoSecret(t *testing.T) {
	f := newDeployFixture(t)
	store := connector.NewStore(f.root)
	if err := store.Set(connector.Config{Sink: "https://lore.alepha.dev", Secret: testSecret}); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveWelcome(connector.Welcome{Slug: "ovh-1"}); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	f.server.registerConnectorRoutes(mux)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/connector", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /connector = %d: %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "est_") {
		t.Fatalf("the control API leaked the secret: %s", rec.Body)
	}
	var report connectorReport
	if err := json.Unmarshal(rec.Body.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	if !report.Configured || report.Sink != "https://lore.alepha.dev" || report.Slug != "ovh-1" || report.Connected {
		t.Fatalf("unexpected report: %+v", report)
	}
}

func TestControlConnectorReportUnconfigured(t *testing.T) {
	f := newDeployFixture(t)
	report := f.server.connectorReport()
	if report.Configured || report.Sink != "" || report.Connected {
		t.Fatalf("a fresh server must report an unconfigured, down connector: %+v", report)
	}
}

func TestControlConnectorReloadNeverBlocks(t *testing.T) {
	/*
		The CLI paths that never serve have no dial loop, and a serve whose
		loop is busy must not hang the control API: a poke is a flag, not a
		queue.
	*/
	f := newDeployFixture(t)
	mux := http.NewServeMux()
	f.server.registerConnectorRoutes(mux)
	for i := 0; i < 3; i++ {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/connector/reload", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("POST /connector/reload = %d", rec.Code)
		}
	}

	f.server.connectorReload = make(chan struct{}, 1)
	for i := 0; i < 3; i++ {
		f.server.pokeConnectorReload()
	}
	select {
	case <-f.server.connectorReload:
	default:
		t.Fatal("a poke must reach the loop")
	}
	select {
	case <-f.server.connectorReload:
		t.Fatal("three pokes must collapse into one pending wake-up")
	default:
	}
}

func TestControlConnectorReportReflectsTheLiveStatus(t *testing.T) {
	f := newDeployFixture(t)
	f.server.connectorStatus = connector.NewStatus()
	f.server.connectorStatus.Up(time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC))
	report := f.server.connectorReport()
	if !report.Connected || report.Since != "2026-09-05T12:00:00Z" {
		t.Fatalf("the report must read the live status: %+v", report)
	}
}

// A one-time enrolment secret (#Q3165) is exchanged before anything is
// stored: the file holds the long-lived secret Lore answered, and neither is
// printed.
func TestConnectorSetExchangesAnEnrolmentSecretBeforeStoring(t *testing.T) {
	const enrolment = "enr_0123456789abcdef0123456789abcdef"
	var gotAuth string
	lore := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != connector.EnrolPath {
			http.NotFound(w, r)
			return
		}
		gotAuth = r.Header.Get("Authorization")
		_ = json.NewEncoder(w).Encode(connector.Enrolled{Secret: testSecret, Slug: "small-skilled-pie"})
	}))
	defer lore.Close()

	store := connector.NewStore(servedRoot(t))
	var out bytes.Buffer
	if err := connectorSetWith(store, []string{lore.URL, enrolment}, &out, lore.Client()); err != nil {
		t.Fatal(err)
	}
	if gotAuth != "Bearer "+enrolment {
		t.Fatalf("exchange sent %q", gotAuth)
	}
	cfg, ok, err := store.Load()
	if err != nil || !ok || cfg.Secret != testSecret {
		t.Fatalf("stored %+v ok=%v err=%v, want the exchanged secret", cfg, ok, err)
	}
	printed := out.String()
	if strings.Contains(printed, enrolment) || strings.Contains(printed, testSecret) {
		t.Fatalf("a secret was printed: %s", printed)
	}
	if !strings.Contains(printed, "enrolled as host small-skilled-pie") {
		t.Fatalf("missing the host it joined: %s", printed)
	}
}

// A refused enrolment stores nothing and says what to do.
func TestConnectorSetStoresNothingWhenTheEnrolmentIsRefused(t *testing.T) {
	lore := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer lore.Close()

	store := connector.NewStore(servedRoot(t))
	err := connectorSetWith(store, []string{lore.URL, "enr_0123456789abcdef"}, &bytes.Buffer{}, lore.Client())
	if err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("want a refusal naming expiry, got %v", err)
	}
	if _, ok, _ := store.Load(); ok {
		t.Fatal("a refused enrolment stored a connector")
	}
}

// The enrolment secret never goes to a cleartext sink off the machine.
func TestConnectorSetNeverExchangesOverCleartext(t *testing.T) {
	store := connector.NewStore(servedRoot(t))
	err := connectorSetWith(store, []string{"http://lore.alepha.dev", "enr_0123456789abcdef"}, &bytes.Buffer{}, nil)
	if err == nil || !strings.Contains(err.Error(), "cleartext") {
		t.Fatalf("want the cleartext refusal, got %v", err)
	}
}

func TestConnectorShowSaysWhyTheServerCouldNotBeAsked(t *testing.T) {
	/*
		Host `ovh`, 2026-11-07: `bay connector show` said "bay serve is not
		running" on a host where it was running. The line now names the
		socket it tried and the error, and says "not running" only when the
		error shows that.
	*/
	configured := func(t *testing.T) *connector.Store {
		t.Helper()
		store := connector.NewStore(servedRoot(t))
		if err := store.Set(connector.Config{Sink: "https://lore.alepha.dev", Secret: testSecret}); err != nil {
			t.Fatal(err)
		}
		return store
	}
	show := func(t *testing.T, sock string) string {
		t.Helper()
		prev := socketFlag
		socketFlag = sock
		t.Cleanup(func() { socketFlag = prev })
		var out bytes.Buffer
		if err := connectorShow(configured(t), &out); err != nil {
			t.Fatal(err)
		}
		return out.String()
	}
	shortDir := func(t *testing.T) string {
		t.Helper()
		// A unix socket path is capped near 104 bytes: t.TempDir() is too long on macOS.
		dir, err := os.MkdirTemp("", "bay")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { os.Chmod(dir, 0o700); os.RemoveAll(dir) })
		return dir
	}

	t.Run("a socket that names nothing is not running, with the path", func(t *testing.T) {
		sock := filepath.Join(shortDir(t), "control.sock")
		text := show(t, sock)
		if !strings.Contains(text, "bay serve is not running") || !strings.Contains(text, sock) {
			t.Fatalf("a missing socket must say not running and name it:\n%s", text)
		}
	})

	t.Run("a running server's error answer is not 'not running'", func(t *testing.T) {
		sock := filepath.Join(shortDir(t), "control.sock")
		ln, err := net.Listen("unix", sock)
		if err != nil {
			t.Fatal(err)
		}
		srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			fmt.Fprint(w, `{"message":"the connector is wedged"}`)
		})}
		go srv.Serve(ln)
		t.Cleanup(func() { srv.Close() })

		text := show(t, sock)
		if strings.Contains(text, "not running") {
			t.Fatalf("a server that answered is running:\n%s", text)
		}
		if !strings.Contains(text, "the connector is wedged") || !strings.Contains(text, sock) {
			t.Fatalf("the API's own error and the socket must be shown:\n%s", text)
		}
	})

	t.Run("a socket out of reach is a permission problem, not a stopped server", func(t *testing.T) {
		if os.Geteuid() == 0 {
			t.Skip("root reads through any mode")
		}
		dir := shortDir(t)
		sock := filepath.Join(dir, "control.sock")
		listenSocket(t, sock)
		if err := os.Chmod(dir, 0); err != nil {
			t.Fatal(err)
		}
		text := show(t, sock)
		if strings.Contains(text, "not running") || !strings.Contains(text, "permission denied") || !strings.Contains(text, sock) {
			t.Fatalf("an unreachable socket must say permission denied and name it:\n%s", text)
		}
	})

	t.Run("no socket at the guessed paths names them and the way out", func(t *testing.T) {
		_, sock := installerLayout(t)
		text := show(t, "")
		if !strings.Contains(text, "no control socket") || !strings.Contains(text, sock) || !strings.Contains(text, "--control-socket") {
			t.Fatalf("a missing socket must name the paths tried and the flag:\n%s", text)
		}
	})

	t.Run("a guessed socket hidden by permissions says so", func(t *testing.T) {
		if os.Geteuid() == 0 {
			t.Skip("root reads through any mode")
		}
		_, sock := installerLayout(t)
		listenSocket(t, sock)
		dir := filepath.Dir(sock)
		if err := os.Chmod(dir, 0); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { os.Chmod(dir, 0o700) })
		text := show(t, "")
		if strings.Contains(text, "not running") || !strings.Contains(text, "permission denied") {
			t.Fatalf("a socket hidden by permissions must say so:\n%s", text)
		}
	})
}
