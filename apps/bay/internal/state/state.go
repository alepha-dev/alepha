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
	Name string `json:"name"`
	Env  string `json:"env"`
	// Domains is every hostname this instance answers on, canonical first.
	//
	// A list because an apex and its `www` are one site, and because a custom
	// domain does not replace the `<name>.<base-domain>` an app was first
	// reachable at — both keep serving until someone says otherwise.
	//
	Domains []string `json:"domains,omitempty"`
	// LegacyDomain is the single `domain` string that preceded Domains.
	//
	// A plain field rather than a custom UnmarshalJSON, and that is the whole
	// point. A method on App is PROMOTED to every type that embeds App — the
	// control API's listedApp does — and a promoted unmarshaller decodes only
	// the fields it knows, silently dropping everything the outer type adds.
	// That cost an hour: `bay top` reported a running app as stopped because
	// `running` never reached it.
	//
	// Folded into Domains and cleared by Open, so it is read once and never
	// written back — `omitempty` keeps it out of the file after that.
	LegacyDomain string `json:"domain,omitempty"`
	Release      string `json:"release"` // directory name under releases/
	Port         int    `json:"port"`    // loopback port the app listens on
	Runtime      string `json:"runtime"`
	// Static is true when the artifact is a site Bay serves from disk, with no
	// process behind it. Derived from the manifest at deploy time.
	//
	// Persisted rather than recomputed because the proxy branches on it for
	// every request, and re-reading the manifest per request to answer a
	// question fixed at deploy time is not a trade worth making.
	//
	// Absent in every state file written before static hosting, which decodes to
	// false — the answer that keeps an existing host supervising its apps after
	// an upgrade.
	Static bool `json:"static,omitempty"`
	// Backups is true when Bay provisioned the app's database and can therefore
	// snapshot it. Derived from the manifest at deploy time.
	//
	// An app on a BYO `DATABASE_URL` has nothing Bay could back up, and without
	// this it would sit at "never backed up" forever — a warning that is both
	// permanent and wrong, which is how people learn to ignore warnings.
	Backups bool `json:"backups"`

	// Stopped is the INTENT: somebody asked for this instance to be out of
	// service, and it must stay out of service across a reboot and across a
	// Bay upgrade.
	//
	// Never the truth. Whether a process is alive is asked of the supervisor
	// per request, and a crash must not be reported as a deliberate stop.
	// These are two columns everywhere they travel: `inactive` with this flag
	// is a stop somebody owns, `inactive` without it is a process nobody asked
	// to stop.
	//
	// Absent in every state file written before the stop verb, which decodes
	// to false — the answer that keeps an existing host starting its apps
	// after an upgrade.
	Stopped bool `json:"stopped,omitempty"`

	// StorageBackend is where this app's blobs live: "local" (a directory under
	// the instance) or "s3" (Bay's configured bucket). Empty on apps that
	// declare no bucket, and on records written before this field existed.
	//
	// Deploy-owned and recorded rather than re-derived, because two other
	// decisions read it and both are wrong if they guess: the sandbox stops
	// granting `storage/` to an S3-backed app, and the backup skips its storage
	// tar. Re-deriving would mean parsing the app's `.env` from the supervisor,
	// which is the app's file, not Bay's source of truth.
	StorageBackend string `json:"storageBackend,omitempty"`

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

	// Crons is how many cron expressions the artifact declared. Derived from the
	// manifest at deploy time, so it is replaced on every deploy rather than
	// carried forward — it describes the release, not the instance.
	//
	// Stored only so that "no traffic in 92 days" can be read correctly. An app
	// whose whole job is a weekly email serves nobody and would look abandoned;
	// saying it has crons is what stops someone deleting it. Bay does not act on
	// this, and deliberately does not store the expressions: it would then be
	// tempted to schedule them, which Alepha already does better in-process.
	Crons int `json:"crons,omitempty"`

	// LastRequestAt is when this app last ANSWERED a request, RFC3339 UTC.
	// Empty means it never has.
	//
	// The question it exists for is "which of these prototypes is dead?" — the
	// one an operator actually asks when twenty of them share a host. Recorded
	// by the proxy rather than reported by the app, because the proxy serves
	// static files and prerendered HTML itself (see `proxy.findStatic`): an app
	// that answers no requests at all can still be the one somebody reads every
	// morning, and asking the app would call it idle.
	LastRequestAt string `json:"lastRequestAt,omitempty"`
}

// Key is the stable identifier for an app instance.
func (a App) Key() string { return a.Name + "/" + a.Env }

// Domain is the canonical hostname — the one to print, log and link to.
//
// Empty when the app has none, which is a real state: an instance registered
// before a base domain was configured has nowhere to be reached yet.
func (a App) Domain() string {
	if len(a.Domains) == 0 {
		return ""
	}
	return a.Domains[0]
}

// Serves reports whether this instance answers on a hostname.
func (a App) Serves(host string) bool {
	for _, d := range a.Domains {
		if d == host {
			return true
		}
	}
	return false
}

// migrateDomains folds the legacy `domain` string into the list.
//
// Called once, by Open. This is the compatibility that matters: Bay reads the
// state file at boot on a host that is already serving traffic. Without it, the
// first start after an upgrade would find no domain on any app, route nothing,
// and — worse — ask the CA for nothing, so certificates would lapse while the
// registry looked healthy.
//
// One-way, deliberately. Once rewritten, the file carries `domains` only, so
// DOWNGRADING Bay loses the routing: rolling back means restoring the `.bak`
// alongside the binary, not just swapping the binary.
func (s *State) migrateDomains() {
	for i := range s.Apps {
		app := &s.Apps[i]
		if len(app.Domains) == 0 && app.LegacyDomain != "" {
			app.Domains = []string{app.LegacyDomain}
		}
		// Cleared whether or not it was used, so the next write drops it and a
		// later reader is never asked to reconcile two sources of truth.
		app.LegacyDomain = ""
	}
}

// State is the whole persisted document.
type State struct {
	Version int   `json:"version"`
	Apps    []App `json:"apps"`
	// BaseDomain is what app subdomains are composed against. It belongs to the
	// Bay installation, not to any artifact — the same artifact must be
	// deployable on any Bay without editing it.
	BaseDomain string `json:"baseDomain"`
	// S3 is where backups go. Stored here rather than in a separate file so a
	// single 0600 root-owned document holds everything an operator configures.
	//
	// ⚠ These credentials can delete backups. They are never written into an
	// app's environment — that is what `Storage` below is for, and why the two
	// are separate fields rather than one reused config.
	S3 *S3Config `json:"s3,omitempty"`
	// Storage is where hosted apps put their blobs, handed to each app that
	// declares a bucket.
	//
	// Deliberately NOT `S3` above. Every app receives these credentials in its
	// own `.env`, so they must be a second, narrower token: an app holding the
	// backup key could delete its own backups, which is the one thing backups
	// exist to prevent. Pointing both at the same bucket is fine and expected —
	// the key layouts do not collide — but they must be different credentials.
	Storage *S3Target `json:"storage,omitempty"`
}

// S3Target addresses an S3-compatible bucket (R2, MinIO, AWS).
//
// Split out of S3Config so backups and app storage can describe the same kind
// of endpoint without sharing one credential. Embedded rather than nested:
// `encoding/json` flattens an embedded struct with no tag, so `s3` keeps the
// exact document shape every deployed Bay already wrote.
type S3Target struct {
	Endpoint  string `json:"endpoint"`
	Bucket    string `json:"bucket"`
	AccessKey string `json:"accessKey"`
	SecretKey string `json:"secretKey"`
	Region    string `json:"region,omitempty"`
}

// S3Config is a target plus the retention that only backups have.
type S3Config struct {
	S3Target
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
	s.state.migrateDomains()
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
		if a.Serves(domain) {
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
// redeploy — `LastBackupAt` would have, which is worse than most: the staleness
// warning would go quiet exactly when someone redeploys.
func (s *Store) Upsert(app App) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, a := range s.state.Apps {
		if a.Key() == app.Key() {
			app.LastBackupAt = a.LastBackupAt
			app.LastBackupKey = a.LastBackupKey
			app.LastBackupError = a.LastBackupError
			// Traffic history belongs to the instance, not the release. Resetting
			// it here would make every app read "no traffic ever" right after a
			// deploy — so the staleness badge would be blank for exactly the apps
			// someone is actively working on.
			app.LastRequestAt = a.LastRequestAt
			// ⚠️ `Stopped` is deliberately NOT carried forward, unlike every
			// other runtime-owned field above. A deploy is an instruction to
			// run THIS release, and `deployArtifact` already calls `start`
			// unconditionally at the end of a successful one - so carrying
			// the flag would leave an app running and marked stopped, which
			// the next boot would then take down. Dropping it makes the
			// existing behaviour explicit rather than accidental.
			s.state.Apps[i] = app
			return s.flush()
		}
	}
	s.state.Apps = append(s.state.Apps, app)
	return s.flush()
}

/*
RecordLastRequest stamps when an app last answered a request.

Monotonic on purpose. The proxy accumulates timestamps in memory and a ticker
drains them, so a batch can arrive late — after a restart, or behind a slow
flush — carrying a stamp older than one already recorded. Letting it win would
make an app somebody just loaded read as abandoned, and a badge that says "no
traffic for 40 days" about a page opened a minute ago is worse than no badge at
all: it is the one reading that gets an app deleted.

An unparseable stored value is overwritten rather than defended. It means the
state was hand-edited or written by another version, and the current answer is
worth more than an unreadable one.
*/
func (s *Store) RecordLastRequest(key string, at time.Time) error {
	stamp := at.UTC().Format(time.RFC3339)
	return s.mutate(key, func(a *App) {
		if a.LastRequestAt != "" {
			if prev, err := time.Parse(time.RFC3339, a.LastRequestAt); err == nil && prev.After(at) {
				return
			}
		}
		a.LastRequestAt = stamp
	})
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

// SetStorageBackend records where an app's blobs live, after a migration has
// actually moved them.
func (s *Store) SetStorageBackend(key, backend string) error {
	return s.mutate(key, func(a *App) { a.StorageBackend = backend })
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

/*
SetStopped records whether an instance is deliberately out of service.

The intent, persisted, and the one thing that makes a stop survive a Bay
restart on any runner: the boot loop reads it. Never the truth - whether a
process is alive is asked of the supervisor, per request, so a crash is never
reported as a deliberate stop.
*/
func (s *Store) SetStopped(key string, stopped bool) error {
	return s.mutate(key, func(a *App) { a.Stopped = stopped })
}

// ClaimedBy reports which app already serves a domain, if any.
func (s *Store) ClaimedBy(domain string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, a := range s.state.Apps {
		if a.Serves(domain) {
			return a.Key(), true
		}
	}
	return "", false
}

// Remove unregisters an app. Returns false when it was not registered.
func (s *Store) Remove(key string) (App, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, a := range s.state.Apps {
		if a.Key() == key {
			s.state.Apps = append(s.state.Apps[:i], s.state.Apps[i+1:]...)
			return a, true, s.flush()
		}
	}
	return App{}, false, nil
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

// CredentialsShared reports whether apps hold the same key that reaches
// backups.
//
// True after `bay config s3`, which sets both halves from one credential
// because a one-operator fleet should not need two tokens to get started. It is
// the less safe arrangement: an app given that key can delete every backup on
// this host, which is the one thing backups exist to prevent.
//
// Reported rather than refused. The operator chose it; what must not happen is
// them forgetting — so `bay status` and the config readback both say so for as
// long as it is true.
func (s *Store) CredentialsShared() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.state.S3 == nil || s.state.Storage == nil {
		return false
	}
	return s.state.S3.AccessKey == s.state.Storage.AccessKey &&
		s.state.S3.SecretKey == s.state.Storage.SecretKey
}

// Storage returns the bucket hosted apps write their blobs to, or nil.
//
// A copy, like S3(): a caller that edits what it got back must not be editing
// the live registry behind the mutex.
func (s *Store) Storage() *S3Target {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.state.Storage == nil {
		return nil
	}
	copied := *s.state.Storage
	return &copied
}

// SetStorage records where hosted apps put their blobs.
func (s *Store) SetStorage(cfg *S3Target) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Storage = cfg
	return s.flush()
}

// HasDomain reports whether a hostname is registered. It is the guard behind
// on-demand certificate issuance: an unknown host must never reach the CA.
func (s *Store) HasDomain(host string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, a := range s.state.Apps {
		if a.Serves(host) {
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
		// A static app has no port. Recording its zero would claim a port
		// number that means "none", and hand every reader of this map a phantom
		// entry to explain away.
		if a.Port == 0 {
			continue
		}
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
