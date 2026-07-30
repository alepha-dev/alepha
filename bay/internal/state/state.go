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
	"time"
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
	// ControlAPI is true when the operator granted this app access to Bay's
	// control API, by putting its unix user in the control group.
	//
	// Granted by the operator, never by the artifact. A manifest travels inside
	// the archive, so letting it decide would let an app declare itself
	// administrator of its own host — harmless while one person deploys
	// everything, and a privilege escalation the moment bay-ui accepts an upload
	// from someone else.
	//
	// This is root-equivalent: an app that can reach the control API can deploy
	// code, read every other app's secrets, and delete every backup.
	ControlAPI bool `json:"controlApi"`
	// Backups is true when Bay provisioned the app's database and can therefore
	// snapshot it. Derived from the manifest at deploy time.
	//
	// An app on a BYO `DATABASE_URL` has nothing Bay could back up, and without
	// this it would sit at "never backed up" forever — a warning that is both
	// permanent and wrong, which is how people learn to ignore warnings.
	Backups bool `json:"backups"`

	// LastBackupAt is when this app last had a VERIFIED backup uploaded, RFC3339
	// UTC. Empty means never.
	//
	// This is the observable the whole backup story rests on. A timer that runs
	// is not what protects data — noticing that it stopped is, and that needs a
	// timestamp someone can look at.
	LastBackupAt string `json:"lastBackupAt,omitempty"`
	// LastBackupKey is the S3 object the last successful run wrote.
	LastBackupKey string `json:"lastBackupKey,omitempty"`
	// LastBackupError is when and why the most recent attempt failed. Cleared on
	// the next success.
	LastBackupError string `json:"lastBackupError,omitempty"`
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

// Upsert inserts or replaces an app's DEPLOY-owned fields and persists.
//
// Runtime-owned fields are carried forward from the existing record rather than
// taken from the argument. A deploy builds a fresh App from the artifact and
// knows nothing about them, so replacing wholesale silently reset them on every
// redeploy — `Sleeping` already did, and `LastBackupAt` would have, which is
// worse: the staleness warning would go quiet exactly when someone redeploys.
func (s *Store) Upsert(app App) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, a := range s.state.Apps {
		if a.Key() == app.Key() {
			app.Sleeping = a.Sleeping
			// Carried forward so a redeploy without the flag does not silently
			// revoke a grant the operator made on purpose.
			if a.ControlAPI {
				app.ControlAPI = true
			}
			app.LastBackupAt = a.LastBackupAt
			app.LastBackupKey = a.LastBackupKey
			app.LastBackupError = a.LastBackupError
			s.state.Apps[i] = app
			return s.flush()
		}
	}
	s.state.Apps = append(s.state.Apps, app)
	return s.flush()
}

// RecordBackupSuccess stamps a completed backup.
func (s *Store) RecordBackupSuccess(key, s3Key string, at time.Time) error {
	return s.mutate(key, func(a *App) {
		a.LastBackupAt = at.UTC().Format(time.RFC3339)
		a.LastBackupKey = s3Key
		// Cleared on success so a stale reason never outlives the failure.
		a.LastBackupError = ""
	})
}

// RecordBackupFailure stores why the last attempt failed.
//
// `LastBackupAt` is deliberately NOT advanced: it means "last time we had a
// usable backup", so a run of failures keeps ageing it and the staleness
// warning keeps growing. Recording the reason separately is what distinguishes
// "backups are failing" from "the scheduler stopped" — without it the two look
// identical from the outside.
func (s *Store) RecordBackupFailure(key, reason string, at time.Time) error {
	return s.mutate(key, func(a *App) {
		a.LastBackupError = at.UTC().Format(time.RFC3339) + ": " + reason
	})
}

// SetRelease repoints an app at another release (deploy swap, rollback).
func (s *Store) SetRelease(key, release string) error {
	return s.mutate(key, func(a *App) { a.Release = release })
}

// mutate applies fn to one app and persists, or reports that it is unknown.
func (s *Store) mutate(key string, fn func(*App)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.state.Apps {
		if s.state.Apps[i].Key() == key {
			fn(&s.state.Apps[i])
			return s.flush()
		}
	}
	return fmt.Errorf("unknown app %q", key)
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
