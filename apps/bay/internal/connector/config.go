// Package connector is how a Bay machine is told which Lore to dial.
//
// One direction only, and that is the whole security argument: this machine
// dials OUT to the sink and holds a websocket open; nothing here listens, so
// there is no inbound port, no firewall rule and no certificate to arrange. The
// secret authenticates a machine, not a person: it opens the estate's socket
// and nothing else, and it grants nothing on this host.
//
// This file is the configuration half: the credential on disk, the cached
// welcome frame, and the rules a sink has to pass. The connection itself is
// the client in this package's other files.
package connector

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// FileName is where the credential lives, under Bay's root, beside state.json.
//
// 0600 and owned by the service user: this is a bearer secret. Kept out of the
// backup set for the same reason `.env` is. A credential that leaves for
// object storage every night is a credential living in one more place, and
// re-minting one is a single command on the Lore side.
const FileName = "connector.json"

// WelcomeFileName caches the last `welcome` frame Lore sent, beside the
// credential. It holds the estate's slug and switches and no secret, and it is
// what `bay connector show` prints when `bay serve` is not running.
const WelcomeFileName = "connector-welcome.json"

// Mode is the permission both files are written with.
const Mode = 0o600

// SecretPrefix is what every estate secret Lore mints starts with. A sigil
// token (`sg_`) belongs in an app's environment, and a token of any other
// shape is a paste error, so the prefix is refused here rather than at the
// first failed dial.
const SecretPrefix = "est_"

// SocketPath is the endpoint on the sink, `EstateSocketController.PATH` on the
// Lore side. Wire format v1, folio #1198.
const SocketPath = "/ws/estates"

// Config is the one Lore this machine dials.
//
// One, not a list: an estate belongs to one Lore instance, and a machine
// reporting to two would be two estates with one secret each, which is two
// configs. `Sink` is the origin (`https://lore.alepha.dev`); the websocket URL
// is derived from it by SocketURL.
type Config struct {
	Sink   string `json:"sink"`
	Secret string `json:"secret"`
}

// Welcome is what Lore says about the estate on every connect, cached for the
// commands that run in another process.
type Welcome struct {
	EstateID             string    `json:"estateId"`
	Slug                 string    `json:"slug"`
	DeployAllowed        bool      `json:"deployAllowed"`
	StatsIntervalSeconds int       `json:"statsIntervalSeconds"`
	ReceivedAt           time.Time `json:"receivedAt"`
}

// Store reads and writes the two files.
type Store struct{ root string }

func NewStore(root string) *Store { return &Store{root: root} }

// Path is where the credential is, for messages.
func (s *Store) Path() string { return filepath.Join(s.root, FileName) }

func (s *Store) welcomePath() string { return filepath.Join(s.root, WelcomeFileName) }

// Load returns the config and whether one exists.
//
// An absent file is not an error: a Bay that dials nobody is the normal state,
// and the whole point is that it works standalone. There is no default sink,
// deliberately: an unconfigured connector is inert, never pointed at somebody
// else's server.
func (s *Store) Load() (Config, bool, error) {
	raw, err := os.ReadFile(s.Path())
	if os.IsNotExist(err) {
		return Config{}, false, nil
	}
	if err != nil {
		return Config{}, false, fmt.Errorf("read %s: %w", s.Path(), err)
	}
	var cfg Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return Config{}, false, fmt.Errorf("parse %s: %w", s.Path(), err)
	}
	if cfg.Sink == "" || cfg.Secret == "" {
		return Config{}, false, fmt.Errorf("%s is incomplete: run `bay connector set` again", s.Path())
	}
	return cfg, true, nil
}

// Set validates and persists the config, replacing whatever was there.
//
// A new sink or secret means a different estate, so the cached welcome of the
// old one is dropped with it: `show` must not print the previous estate's slug
// beside the new sink.
func (s *Store) Set(cfg Config) error {
	sink, err := ValidateSink(cfg.Sink)
	if err != nil {
		return err
	}
	if err := ValidateSecret(cfg.Secret); err != nil {
		return err
	}
	if err := s.write(s.Path(), Config{Sink: sink, Secret: cfg.Secret}); err != nil {
		return err
	}
	return s.ClearWelcome()
}

// Clear removes the credential and the cached welcome. Absent files are fine:
// clearing twice is not an error, it is the same instruction.
func (s *Store) Clear() error {
	if err := os.Remove(s.Path()); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove %s: %w", s.Path(), err)
	}
	return s.ClearWelcome()
}

// LoadWelcome returns the cached welcome and whether one exists.
func (s *Store) LoadWelcome() (Welcome, bool, error) {
	raw, err := os.ReadFile(s.welcomePath())
	if os.IsNotExist(err) {
		return Welcome{}, false, nil
	}
	if err != nil {
		return Welcome{}, false, fmt.Errorf("read %s: %w", s.welcomePath(), err)
	}
	var w Welcome
	if err := json.Unmarshal(raw, &w); err != nil {
		return Welcome{}, false, fmt.Errorf("parse %s: %w", s.welcomePath(), err)
	}
	return w, true, nil
}

// SaveWelcome caches what Lore just said. Written by `serve` on every welcome
// and config frame, read by `show` in another process.
func (s *Store) SaveWelcome(w Welcome) error {
	return s.write(s.welcomePath(), w)
}

// ClearWelcome forgets the cached welcome.
func (s *Store) ClearWelcome() error {
	if err := os.Remove(s.welcomePath()); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove %s: %w", s.welcomePath(), err)
	}
	return nil
}

// write persists a document atomically, at Mode.
//
// temp + rename, like every other file Bay owns: a partial write here would
// leave the machine dialing nobody, which the sink sees as the host going
// quiet and cannot tell apart from the host being down.
func (s *Store) write(path string, doc any) error {
	raw, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, Mode); err != nil {
		return err
	}
	// WriteFile only applies the mode to a file it creates; a leftover temp
	// file from an interrupted write keeps whatever mode it had.
	if err := os.Chmod(tmp, Mode); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// ValidateSink checks a Lore origin and returns it normalised.
//
// An origin and nothing more: scheme, host, port. A path, a query, a fragment
// or credentials in the URL are refused rather than dropped, because each one
// is a sign the operator pasted the wrong thing (a page URL, a token URL), and
// silently keeping the host would dial a Lore they did not name.
//
// `https` is the rule. `http` is accepted for a loopback host only, so dev and
// the end-to-end test can run against `http://127.0.0.1:<port>` and nothing
// else can be pointed at a cleartext sink: the secret is a bearer on every
// dial, and a plain-HTTP hop anywhere else would put it on the wire in clear.
func ValidateSink(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("no Lore URL given")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("%q is not a URL: %w", raw, err)
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return "", fmt.Errorf("%q must start with https:// (or http:// for a loopback host)", raw)
	}
	if u.Host == "" || u.Hostname() == "" {
		return "", fmt.Errorf("%q has no host", raw)
	}
	if u.User != nil {
		return "", fmt.Errorf("%q carries credentials in the URL; the secret is the second argument, not part of the sink", raw)
	}
	if (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("%q is a page, not a Lore origin: give the origin only, like https://lore.alepha.dev", raw)
	}
	if u.Scheme == "http" && !IsLoopback(u.Hostname()) {
		return "", fmt.Errorf("%q is a cleartext sink: the secret would cross the network in clear. Use https://, or http:// only for a loopback host", raw)
	}
	return u.Scheme + "://" + strings.ToLower(u.Host), nil
}

// IsLoopback reports whether a hostname names this machine and nothing else.
func IsLoopback(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

// ValidateSecret checks the shape of an estate secret, and nothing about its
// validity: only the sink can say whether it resolves.
func ValidateSecret(secret string) error {
	if secret == "" {
		return errors.New("no secret given")
	}
	if strings.TrimSpace(secret) != secret {
		return errors.New("the secret has surrounding whitespace; paste it exactly as Lore showed it")
	}
	if !strings.HasPrefix(secret, SecretPrefix) {
		return fmt.Errorf(
			"that is not an estate secret: expected one starting with `%s`. "+
				"A sigil token (`sg_`) belongs in an app's environment, not here", SecretPrefix)
	}
	if len(secret) <= len(SecretPrefix) {
		return errors.New("the secret is truncated")
	}
	return nil
}

// SocketURL derives the websocket endpoint from a validated sink.
func SocketURL(sink string) string {
	switch {
	case strings.HasPrefix(sink, "https://"):
		return "wss://" + strings.TrimPrefix(sink, "https://") + SocketPath
	case strings.HasPrefix(sink, "http://"):
		return "ws://" + strings.TrimPrefix(sink, "http://") + SocketPath
	}
	return sink + SocketPath
}

// Status is what a running `bay serve` knows about its connection, for the
// control API. Written by the client goroutine, read by `GET /connector`.
//
// Kept in memory on purpose: a status file would lie after a crash, which is
// why `show` asks the running server and prints "not running" when nothing
// answers.
type Status struct {
	mu        sync.Mutex
	connected bool
	since     time.Time
	lastError string
}

// Snapshot is the wire shape of a Status.
type Snapshot struct {
	Connected bool   `json:"connected"`
	Since     string `json:"since,omitempty"`
	LastError string `json:"lastError,omitempty"`
}

func NewStatus() *Status { return &Status{} }

// Up records a successful connect.
func (st *Status) Up(at time.Time) {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.connected = true
	st.since = at
	st.lastError = ""
}

// Down records a drop or a failed dial, keeping the reason for `show`.
func (st *Status) Down(err error) {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.connected = false
	st.since = time.Time{}
	if err != nil {
		st.lastError = err.Error()
	}
}

// Snapshot reads the status without holding the lock for the caller.
func (st *Status) Snapshot() Snapshot {
	if st == nil {
		return Snapshot{}
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	out := Snapshot{Connected: st.connected, LastError: st.lastError}
	if st.connected {
		out.Since = st.since.UTC().Format(time.RFC3339)
	}
	return out
}
