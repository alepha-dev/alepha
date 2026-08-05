// Package connector is how a Bay tells Lore what it is hosting.
//
// One direction only: this machine POSTs, and nothing here ever listens. That
// is the whole security argument for the design — the token below authorises
// writing into one project and grants nothing at all on this host, so a leak
// lets someone lie about a fleet rather than deploy to it. A pull model would
// have required the opposite trade.
//
// It also means there is no firewall rule, no inbound port and no certificate
// to arrange: a Bay behind NAT reports exactly as well as one on a public IP.
package connector

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// FileName is where the connector list lives, under Bay's root.
//
// 0600 and root-owned: these are bearer tokens. Kept out of the backup set for
// the same reason `.env` is — a credential that leaves for object storage every
// night is a credential living in one more place, and re-minting one is a
// single command.
const FileName = "connectors.json"

// Mode is the permission the file is published with.
const Mode = 0o600

// Connector is one project this machine reports to.
type Connector struct {
	// Sink is the origin of the Lore instance, e.g. https://lore.alepha.dev.
	Sink string `json:"sink"`
	// Token is the `op_` bearer minted by Lore. Cleartext, necessarily: it has
	// to be presented on every report.
	Token string `json:"token"`
	// Label is what the operator called it, for `bay connector list`. Purely
	// cosmetic — the token is the identity.
	Label string `json:"label,omitempty"`
}

// Prefix returns enough of the token to name it without printing it.
//
// Everything that displays a connector goes through this. A token echoed once
// into a terminal is a token in a scrollback buffer, a screen recording and a
// support paste.
func (c Connector) Prefix() string {
	if len(c.Token) <= 11 {
		return c.Token
	}
	return c.Token[:11] + "…"
}

// Store reads and writes the connector list.
type Store struct{ path string }

func NewStore(root string) *Store {
	return &Store{path: filepath.Join(root, FileName)}
}

func (s *Store) Path() string { return s.path }

// List returns the configured connectors, or an empty slice when there are
// none.
//
// An absent file is not an error: a Bay that reports to nobody is the normal
// state, and the whole point is that it works standalone.
func (s *Store) List() ([]Connector, error) {
	raw, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", s.path, err)
	}
	var out []Connector
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, fmt.Errorf("parse %s: %w", s.path, err)
	}
	return out, nil
}

// Add appends a connector, refusing a token that is already present.
//
// A duplicate is named rather than deduplicated: adding the same token twice
// usually means an operator ran the command again after it appeared to fail,
// and they should learn that the first one worked instead of quietly getting
// two identical reporters.
func (s *Store) Add(c Connector) error {
	if !strings.HasPrefix(c.Token, "op_") {
		return fmt.Errorf(
			"that is not an outpost token: expected one starting with `op_`, got %q. "+
				"A sigil token (`sg_`) belongs in an app's environment, not here", c.Prefix())
	}
	if c.Sink == "" {
		return fmt.Errorf("no sink given")
	}
	existing, err := s.List()
	if err != nil {
		return err
	}
	for _, e := range existing {
		if e.Token == c.Token {
			return fmt.Errorf("that token is already configured (%s)", e.Prefix())
		}
	}
	return s.write(append(existing, c))
}

// Remove drops the connector whose token starts with the given prefix.
//
// By prefix rather than by whole token, because the whole token is exactly what
// an operator does not have in front of them — `bay connector list` shows a
// prefix, and that is what they will type back.
func (s *Store) Remove(prefix string) (Connector, error) {
	existing, err := s.List()
	if err != nil {
		return Connector{}, err
	}
	var kept []Connector
	var removed Connector
	found := false
	for _, e := range existing {
		if !found && strings.HasPrefix(e.Token, prefix) {
			removed, found = e, true
			continue
		}
		kept = append(kept, e)
	}
	if !found {
		return Connector{}, fmt.Errorf("no connector matches %q", prefix)
	}
	return removed, s.write(kept)
}

// write persists the list atomically, at 0600.
//
// temp + rename, like every other file Bay owns: a partial write here would
// leave the machine reporting to nobody, which is a silent failure — the sink
// would simply see it go quiet, which is indistinguishable from the host being
// down.
func (s *Store) write(list []Connector) error {
	if list == nil {
		list = []Connector{}
	}
	raw, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, Mode); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
