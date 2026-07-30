// Package state persists Bay's view of the world to a single JSON file.
//
// Deliberately not a database: the state is small, and a plain file stays
// inspectable, diffable, and repairable with a text editor when everything else
// is on fire.
package state

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// App is one deployed application instance (app + env).
type App struct {
	Name     string `json:"name"`
	Env      string `json:"env"`
	Domain   string `json:"domain"`
	Release  string `json:"release"` // directory name under releases/
	Port     int    `json:"port"`    // loopback port the app listens on
	Runtime  string `json:"runtime"`
	Sleeping bool   `json:"sleeping"`
}

// Key is the stable identifier for an app instance.
func (a App) Key() string { return a.Name + "/" + a.Env }

// State is the whole persisted document.
type State struct {
	Version int   `json:"version"`
	Apps    []App `json:"apps"`
	// Token is the control-plane bearer token.
	Token string `json:"token"`
	// BaseDomain is what app subdomains are composed against. It belongs to the
	// Bay installation, not to any artifact — the same artifact must be
	// deployable on any Bay without editing it.
	BaseDomain string `json:"baseDomain"`
	// S3 is where backups go. Stored here rather than in a separate file so a
	// single 0600 root-owned document holds everything an operator configures.
	//
	// ⚠ These credentials can delete backups. Until apps run under their own
	// unix users, any app on this host can read this file and therefore reach
	// them — see the isolation work.
	S3 *S3Config `json:"s3,omitempty"`
}

// S3Config addresses an S3-compatible bucket (R2, MinIO, AWS).
type S3Config struct {
	Endpoint  string `json:"endpoint"`
	Bucket    string `json:"bucket"`
	AccessKey string `json:"accessKey"`
	SecretKey string `json:"secretKey"`
	Region    string `json:"region,omitempty"`
	// Keep is how many backups to retain per app instance.
	Keep int `json:"keep,omitempty"`
}

// Store guards concurrent access and owns the on-disk file.
type Store struct {
	mu    sync.RWMutex
	path  string
	state State
}

// Open loads the state file, creating an empty one if absent.
func Open(path string) (*Store, error) {
	s := &Store{path: path, state: State{Version: 1}}
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return s, s.flush()
	}
	if err != nil {
		return nil, fmt.Errorf("read state: %w", err)
	}
	if err := json.Unmarshal(raw, &s.state); err != nil {
		return nil, fmt.Errorf("parse state (a .bak sits next to it): %w", err)
	}
	return s, nil
}

// Apps returns a copy of the current app list.
func (s *Store) Apps() []App {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]App, len(s.state.Apps))
	copy(out, s.state.Apps)
	return out
}

// ByDomain resolves the routing decision for an incoming request.
func (s *Store) ByDomain(domain string) (App, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, a := range s.state.Apps {
		if a.Domain == domain {
			return a, true
		}
	}
	return App{}, false
}

// Get looks an app up by "name/env".
func (s *Store) Get(key string) (App, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, a := range s.state.Apps {
		if a.Key() == key {
			return a, true
		}
	}
	return App{}, false
}

// Upsert inserts or replaces an app and persists immediately.
func (s *Store) Upsert(app App) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, a := range s.state.Apps {
		if a.Key() == app.Key() {
			s.state.Apps[i] = app
			return s.flush()
		}
	}
	s.state.Apps = append(s.state.Apps, app)
	return s.flush()
}

// Token returns the control-plane token, generating one on first use.
func (s *Store) Token(generate func() string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.Token == "" {
		s.state.Token = generate()
		if err := s.flush(); err != nil {
			return "", err
		}
	}
	return s.state.Token, nil
}

// BaseDomain returns the configured base domain, if any.
func (s *Store) BaseDomain() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.state.BaseDomain
}

// SetBaseDomain records the base domain, persisting immediately.
func (s *Store) SetBaseDomain(domain string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.BaseDomain == domain {
		return nil
	}
	s.state.BaseDomain = domain
	return s.flush()
}

// S3 returns the backup configuration, or nil when backups are not set up.
func (s *Store) S3() *S3Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.state.S3 == nil {
		return nil
	}
	copied := *s.state.S3
	return &copied
}

// SetS3 records the backup configuration.
func (s *Store) SetS3(cfg *S3Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.S3 = cfg
	return s.flush()
}

// HasDomain reports whether a hostname is registered. It is the guard behind
// on-demand certificate issuance: an unknown host must never reach the CA.
func (s *Store) HasDomain(host string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, a := range s.state.Apps {
		if a.Domain == host {
			return true
		}
	}
	return false
}

// UsedPorts lists every port currently claimed, so allocation can avoid them.
func (s *Store) UsedPorts() map[int]bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	used := make(map[int]bool, len(s.state.Apps))
	for _, a := range s.state.Apps {
		used[a.Port] = true
	}
	return used
}

// flush writes the state atomically: temp file, fsync, rename.
//
// A torn state file is a total outage — the router would come back up with no
// idea where anything lives — so this never writes in place. The previous
// version is kept as .bak.
func (s *Store) flush() error {
	raw, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return fmt.Errorf("encode state: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	if prev, err := os.ReadFile(s.path); err == nil {
		_ = os.WriteFile(s.path+".bak", prev, 0o600)
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".state-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(raw); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), s.path)
}
