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

	"github.com/alepha-dev/bay/internal/backuppolicy"
)

// HostMount is a host path bind-mounted at the same path into an instance's
// container, read-only unless ReadOnly is false.
type HostMount struct {
	Path     string `json:"path"`
	ReadOnly bool   `json:"readOnly"`
}

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
	// to false - the answer that keeps an existing host starting its apps
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
	// LastBackup is what the last successful backup was: its size, how long
	// it took, what asked for it and what each database held. Reported to
	// Lore; nil for a backup taken before Bay recorded it.
	LastBackup *BackupRecord `json:"lastBackup,omitempty"`
	// BackupFailure is the structured side of LastBackupError: the stage and
	// how many attempts in a row have failed. Nil after a success.
	BackupFailure *BackupFailure `json:"backupFailure,omitempty"`
	// BackupCatalog is what the instance's prefix held the last time Bay
	// listed it (after each backup, or when asked), so an inventory says how
	// many backups exist without an S3 call per push.
	BackupCatalog *BackupCatalog `json:"backupCatalog,omitempty"`
	// LastRestore is the last restore into this instance, whatever asked for
	// it and whether it worked.
	LastRestore *RestoreRecord `json:"lastRestore,omitempty"`
	// LastVerifyAt is when a restore test (`bay backup verify`, or the
	// policy's verify.every) last ran, RFC3339 UTC, whatever its outcome;
	// LastVerifyKey the backup it read; LastVerifyError why it failed, empty
	// when it passed.
	LastVerifyAt    string `json:"lastVerifyAt,omitempty"`
	LastVerifyKey   string `json:"lastVerifyKey,omitempty"`
	LastVerifyError string `json:"lastVerifyError,omitempty"`
	// RestorePending is set when Bay created an empty database for this
	// instance but could not find out whether a backup should have been
	// restored into it (no destination yet, bucket unreachable, download or
	// install failed). Nil means nothing is pending.
	//
	// What it guards is retention. The app keeps running and its new data
	// keeps being backed up, but every one of those backups is newer than the
	// real ones, so `keep N` would delete the real data N runs later. While
	// this is set and a backup older than `Since` exists, pruning is skipped.
	RestorePending *RestorePending `json:"restorePending,omitempty"`

	// BackupDeclared is the backup policy the app's deploy asked for
	// (`--backup-policy`), already validated as untrusted input. Replaced on
	// every deploy, like Crons: it describes the release, so a deploy that
	// declares nothing drops it.
	BackupDeclared *backuppolicy.Policy `json:"backupDeclared,omitempty"`
	// BackupOverride is the operator's policy for this instance (`bay backup
	// config`). Above the app's own declaration, and kept across deploys: it is
	// a decision about the instance, not about one release.
	BackupOverride *backuppolicy.Policy `json:"backupOverride,omitempty"`
	// BackupHold is when and why the schedule must leave this app alone: a deploy
	// created its database empty and could not restore the snapshot that may
	// exist. Backing that database up would make it the newest snapshot, and the
	// next plain `bay restore` would install it. Cleared by a restore, and by a
	// backup somebody asked for, which is them saying this database is the one.
	BackupHold string `json:"backupHold,omitempty"`

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

	// RuntimeImage is the image this instance runs on instead of the one Bay
	// would pick from its manifest (an Alpine variant, a custom base). Empty
	// means Bay picks.
	//
	// Recorded on the instance and shown by `bay status`, because it is a
	// choice somebody made and owns: a later reader must be able to see that
	// this app does not follow `bay runtimes update`.
	RuntimeImage string `json:"runtimeImage,omitempty"`

	// HostPort is the host loopback port the live container is published on,
	// when it is not Port. Zero means Port.
	//
	// Separate from Port because blue/green moves it: the next container is
	// published on another host port, health-checked there, and traffic
	// switches by changing this field. Inside the container the app always
	// listens on Port (its SERVER_PORT), so the app's .env never changes with
	// a deploy.
	HostPort int `json:"hostPort,omitempty"`

	// Image is set for an image app: the container image it runs, by digest,
	// instead of an archive in a runtime image. It has no release directory;
	// Release names the digest.
	Image string `json:"image,omitempty"`
	// ContainerPort is the port an image app listens on inside its image. An
	// archive app listens on Port, its SERVER_PORT.
	ContainerPort int `json:"containerPort,omitempty"`
	// HealthPath is the HTTP path that answers 2xx once an image app is ready.
	HealthPath string `json:"healthPath,omitempty"`
	// HealthCheck records which check last decided the instance was ready:
	// "path /x", "image healthcheck" or "tcp", so `bay status` never claims
	// more than was actually checked.
	HealthCheck string `json:"healthCheck,omitempty"`

	// UID is the unix user an archive app's container runs as, its own and
	// stable across deploys, so its data stays its own on disk. Zero until
	// first allocated.
	UID int `json:"uid,omitempty"`
	// Relaxed names the hardening defaults lifted for this instance, by an
	// explicit `bay harden --relax`. Recorded so a later reader sees that this
	// app runs with less isolation than the others, and why it is allowed to.
	Relaxed []string `json:"relaxed,omitempty"`
	// MemoryBytes is this instance's memory ceiling when it is not Bay's
	// default (512 MiB): a JVM service, an app with a large cache. Zero means
	// the default. Set by `bay harden --memory`.
	MemoryBytes int64 `json:"memoryBytes,omitempty"`
	// PidsLimit is this instance's ceiling on processes and threads when it is
	// not Bay's default (256): an app driving a browser runs a few hundred
	// threads. Zero means the default. Set by `bay harden --pids`.
	PidsLimit int `json:"pidsLimit,omitempty"`
	// HostMounts are host paths an operator handed to this instance with
	// `bay harden --mount`, each at the same path inside its container: a
	// display socket, a browser install shared with the host. Never set by a
	// deploy; recorded so `bay status` shows the app sees more than its own.
	HostMounts []HostMount `json:"hostMounts,omitempty"`

	// Stack and Service are set on a stack member: the instance is service
	// Service of stack environment Stack/Env, named "<stack>.<service>".
	// Empty on a standalone app.
	Stack   string `json:"stack,omitempty"`
	Service string `json:"service,omitempty"`
	// ServiceKind is "app" for an `x-lore: { app }` service, which Bay runs
	// itself (blue/green, hardening), or "service" for one compose runs from
	// its image. Empty on a standalone app.
	ServiceKind string `json:"serviceKind,omitempty"`
	// StackApp is the app an "app" service runs: its `x-lore.app`. It is how a
	// deployer that knows only its own app name (the framework's BayAdapter)
	// finds the service to deploy into, through `bay list`. Recorded at each
	// stack deploy, so it follows the compose file.
	StackApp string `json:"stackApp,omitempty"`
	// BackupHook is how a stack service is dumped (`x-lore.backup`), recorded
	// from the revision at deploy time. A service member with a hook has
	// Backups set, so the schedule takes it like any app database.
	BackupHook *BackupHook `json:"backupHook,omitempty"`
}

// RestorePending records when and why an instance started on an empty
// database without its backups having been checked.
type RestorePending struct {
	// Since is RFC3339 UTC. Backups taken before it predate the empty
	// database, so they are the ones worth protecting.
	Since  string `json:"since"`
	Reason string `json:"reason"`
}

// SinceTime parses Since; the zero time when it cannot be read.
func (p RestorePending) SinceTime() time.Time {
	t, _ := time.Parse(time.RFC3339, p.Since)
	return t
}

// BackupRecord is one successful backup as Bay saw it happen.
type BackupRecord struct {
	At          string `json:"at"`
	Key         string `json:"key"`
	Kind        string `json:"kind,omitempty"`
	Trigger     string `json:"trigger,omitempty"`
	Tag         string `json:"tag,omitempty"`
	Release     string `json:"release,omitempty"`
	RawBytes    int64  `json:"rawBytes,omitempty"`
	StoredBytes int64  `json:"storedBytes,omitempty"`
	DurationMs  int64  `json:"durationMs,omitempty"`
	Files       int    `json:"files,omitempty"`
	// Databases is what each SQLite file held, from the bundle's manifest.
	Databases []DatabaseRecord `json:"databases,omitempty"`
	// Anomalies are what looked wrong compared with the backup before it
	// (a database much smaller, one gone, a table emptied). The backup is
	// stored all the same: a warning, never a refusal.
	Anomalies []string `json:"anomalies,omitempty"`
}

// DatabaseRecord is one database of a backup: metadata only, never data.
type DatabaseRecord struct {
	Path        string            `json:"path"`
	RawBytes    int64             `json:"rawBytes"`
	StoredBytes int64             `json:"storedBytes"`
	SHA256      string            `json:"sha256,omitempty"`
	Integrity   string            `json:"integrity,omitempty"`
	Tables      int               `json:"tables"`
	PageSize    int64             `json:"pageSize,omitempty"`
	Pages       int64             `json:"pages,omitempty"`
	FreePages   int64             `json:"freePages,omitempty"`
	JournalMode string            `json:"journalMode,omitempty"`
	TopTables   []TableCount      `json:"topTables,omitempty"`
	Migrations  []MigrationRecord `json:"migrations,omitempty"`
}

// TableCount is one table's row count.
type TableCount struct {
	Table string `json:"table"`
	Rows  int64  `json:"rows"`
}

// MigrationRecord is a migration journal found in a database.
type MigrationRecord struct {
	Table string `json:"table"`
	Count int64  `json:"count"`
	Last  string `json:"last,omitempty"`
}

// BackupFailure is the last failed attempt, structured.
type BackupFailure struct {
	At          string `json:"at"`
	Stage       string `json:"stage,omitempty"`
	Message     string `json:"message"`
	Consecutive int    `json:"consecutive"`
}

// BackupCatalog is a summary of an instance's backups prefix.
type BackupCatalog struct {
	ListedAt   string `json:"listedAt"`
	Count      int    `json:"count"`
	TotalBytes int64  `json:"totalBytes"`
	OldestAt   string `json:"oldestAt,omitempty"`
	NewestAt   string `json:"newestAt,omitempty"`
}

// RestoreRecord is one restore into an instance.
type RestoreRecord struct {
	At  string `json:"at"`
	Key string `json:"key,omitempty"`
	// From is the instance whose backup was read, when not this one.
	From    string `json:"from,omitempty"`
	Reason  string `json:"reason,omitempty"`
	Trigger string `json:"trigger,omitempty"`
	// Status is "done" or "failed"; Error says why it failed.
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
	// PreRestoreKey is the backup taken of the data the restore replaced.
	PreRestoreKey string `json:"preRestoreKey,omitempty"`
	// AppSecret is what the restore did with the instance's key: restored,
	// kept, absent, missing or not-restored. Never the key.
	AppSecret string `json:"appSecret,omitempty"`
	// WithKey records a `bay restore --with-key`: the operator chose to
	// replace the instance's key with the backup's.
	WithKey bool `json:"withKey,omitempty"`
}

// BackupHook is one service's dump declaration: postgres, or a command.
type BackupHook struct {
	PostgresUser string `json:"postgresUser,omitempty"`
	PostgresDB   string `json:"postgresDb,omitempty"`
	Command      string `json:"command,omitempty"`
	Restore      string `json:"restore,omitempty"`
}

// UpstreamPort is the host port to send this instance's traffic to.
func (a App) UpstreamPort() int {
	if a.HostPort != 0 {
		return a.HostPort
	}
	return a.Port
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
	// InstanceStorage is one app instance's OWN upload credential, keyed by
	// "name/env", used instead of `Storage` for that instance (and only it).
	//
	// A map here rather than a field on App: App is what `GET /apps` and the
	// status views serialise, and a secret must never ride along with them.
	// Set by `bay config s3:apps <name/env>`, which proves before storing it
	// that the key cannot reach the backups or any other app's blobs.
	InstanceStorage map[string]*S3Target `json:"instanceStorage,omitempty"`
	// WideInstanceStorage marks the instance keys stored with
	// `--allow-wide-key`: known not to be isolated, so `bay doctor
	// --probe-keys` warns about them instead of failing.
	WideInstanceStorage map[string]bool `json:"wideInstanceStorage,omitempty"`
	// RuntimeLocks maps a runtime image tag ("node:26-slim") to the reference
	// `bay runtimes update` last resolved it to ("node:26-slim@sha256:...").
	//
	// Newer than the digests compiled into this Bay release by construction,
	// so it wins over them; a Bay upgrade that ships newer pins does not
	// clear it, and the next update moves it forward again.
	RuntimeLocks map[string]string `json:"runtimeLocks,omitempty"`
	// Stacks are the compose-described groups of apps and services this Bay
	// runs (epic E74). Their members that run or are routed are Apps too, so
	// the proxy, the runner and every report treat them as instances.
	Stacks []Stack `json:"stacks,omitempty"`
	// RegistryMirror is a pull-through mirror for Docker Hub images
	// (`bay config registry-mirror`): rate limits, company policy.
	RegistryMirror string `json:"registryMirror,omitempty"`
	// Backup is the global backup policy (`bay config backup`), above the
	// built-in defaults and below each app's own. Nil sets nothing.
	Backup *backuppolicy.Policy `json:"backup,omitempty"`
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
			app.LastBackup = a.LastBackup
			app.BackupFailure = a.BackupFailure
			app.BackupCatalog = a.BackupCatalog
			app.LastRestore = a.LastRestore
			app.LastVerifyAt = a.LastVerifyAt
			app.LastVerifyKey = a.LastVerifyKey
			app.LastVerifyError = a.LastVerifyError
			// A redeploy onto the existing database changes nothing about
			// whether the backups taken before it still need protecting.
			app.RestorePending = a.RestorePending
			// The operator's backup policy outlives releases; the app's own
			// declaration (BackupDeclared) comes with each deploy instead.
			app.BackupOverride = a.BackupOverride
			app.BackupHold = a.BackupHold
			// Traffic history belongs to the instance, not the release. Resetting
			// it here would make every app read "no traffic ever" right after a
			// deploy — so the staleness badge would be blank for exactly the apps
			// someone is actively working on.
			app.LastRequestAt = a.LastRequestAt
			// The host port the live container is published on: a deploy
			// upserts BEFORE its new container is up, and the proxy dials this
			// field, so dropping it here would send every request of the
			// deploy window to a port nothing listens on any more. A blue/green
			// switch moves it with SetHostPort once the new one is ready.
			app.HostPort = a.HostPort
			// An image somebody chose for this instance outlives its releases,
			// until `bay runtimes clear` says otherwise.
			app.RuntimeImage = a.RuntimeImage
			// Its own uid owns its files on disk; a new one would leave the app
			// unable to write its own database. Relaxations are a decision about
			// the instance, not about one release.
			app.UID = a.UID
			app.Relaxed = a.Relaxed
			app.MemoryBytes = a.MemoryBytes
			app.PidsLimit = a.PidsLimit
			app.HostMounts = a.HostMounts
			// A member redeployed through the ordinary deploy path is still a
			// member of its stack.
			if app.Stack == "" {
				app.Stack, app.Service, app.ServiceKind = a.Stack, a.Service, a.ServiceKind
			}
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
	return s.RecordBackup(key, BackupRecord{At: at.UTC().Format(time.RFC3339), Key: s3Key})
}

// RecordBackup stamps a completed backup with what is known about it.
func (s *Store) RecordBackup(key string, rec BackupRecord) error {
	return s.mutate(key, func(a *App) {
		a.LastBackupAt = rec.At
		a.LastBackupKey = rec.Key
		// Cleared on success so a stale reason never outlives the failure.
		a.LastBackupError = ""
		a.BackupFailure = nil
		r := rec
		a.LastBackup = &r
		// Only a backup somebody asked for says this database is the one.
		// The safety copies a restore or a deploy take first say nothing of
		// the kind: lifting the hold on one would let the schedule save an
		// empty database over the backups the hold protects.
		if LiftsBackupHold(rec.Trigger) {
			a.BackupHold = ""
		}
	})
}

// LiftsBackupHold says whether a backup taken for trigger vouches for the
// database, and so gives the app back to the schedule.
func LiftsBackupHold(trigger string) bool {
	return trigger == "manual" || trigger == "console"
}

// HoldBackups keeps the schedule off an app. See `App.BackupHold`.
func (s *Store) HoldBackups(key, reason string, at time.Time) error {
	return s.mutate(key, func(a *App) {
		a.BackupHold = at.UTC().Format(time.RFC3339) + ": " + reason
	})
}

// ClearBackupHold gives an app back to the schedule.
func (s *Store) ClearBackupHold(key string) error {
	return s.mutate(key, func(a *App) { a.BackupHold = "" })
}

// RecordBackupFailure stores why the last attempt failed.
//
// `LastBackupAt` is deliberately NOT advanced: it means "last time we had a
// usable backup", so a run of failures keeps ageing it and the staleness
// warning keeps growing. Recording the reason separately is what distinguishes
// "backups are failing" from "the scheduler stopped" — without it the two look
// identical from the outside.
func (s *Store) RecordBackupFailure(key, reason string, at time.Time) error {
	return s.RecordBackupFailureAt(key, "", reason, at)
}

// RecordBackupFailureAt is RecordBackupFailure with the stage that failed
// kept apart, counting how many attempts in a row have now failed.
func (s *Store) RecordBackupFailureAt(key, stage, message string, at time.Time) error {
	return s.mutate(key, func(a *App) {
		reason := message
		if stage != "" {
			reason = stage + ": " + message
		}
		stamp := at.UTC().Format(time.RFC3339)
		a.LastBackupError = stamp + ": " + reason
		consecutive := 1
		if a.BackupFailure != nil {
			consecutive = a.BackupFailure.Consecutive + 1
		}
		a.BackupFailure = &BackupFailure{At: stamp, Stage: stage, Message: message, Consecutive: consecutive}
	})
}

// SetBackupCatalog records what the instance's backups prefix holds.
func (s *Store) SetBackupCatalog(key string, c BackupCatalog) error {
	return s.mutate(key, func(a *App) { a.BackupCatalog = &c })
}

// RecordRestore records a restore into the instance, done or failed.
func (s *Store) RecordRestore(key string, r RestoreRecord) error {
	return s.mutate(key, func(a *App) { a.LastRestore = &r })
}

// RecordVerify stores a restore test's outcome; failure is "" when it passed.
func (s *Store) RecordVerify(key, s3Key, failure string, at time.Time) error {
	return s.mutate(key, func(a *App) {
		a.LastVerifyAt = at.UTC().Format(time.RFC3339)
		a.LastVerifyKey = s3Key
		a.LastVerifyError = failure
	})
}

// SetRestorePending marks an instance as started empty without its backups
// checked.
//
// An instance already pending keeps its original `Since`: the backups taken
// in between are of the empty database, and moving `Since` forward would
// start protecting those instead of the real ones.
func (s *Store) SetRestorePending(key, reason string, at time.Time) error {
	return s.mutate(key, func(a *App) {
		since := at.UTC().Format(time.RFC3339)
		if a.RestorePending != nil && a.RestorePending.Since != "" {
			since = a.RestorePending.Since
		}
		a.RestorePending = &RestorePending{Since: since, Reason: reason}
	})
}

// ClearRestorePending ends the guard: restored, dismissed, or nothing to
// protect.
func (s *Store) ClearRestorePending(key string) error {
	return s.mutate(key, func(a *App) { a.RestorePending = nil })
}

// SetBackupOverride records (or, with nil, clears) the operator's backup
// policy for one instance.
func (s *Store) SetBackupOverride(key string, p *backuppolicy.Policy) error {
	return s.mutate(key, func(a *App) { a.BackupOverride = p })
}

// BackupPolicy is the global backup layer, nil when nothing is set.
func (s *Store) BackupPolicy() *backuppolicy.Policy {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.state.Backup
}

// SetBackupPolicy records (or, with nil, clears) the global backup layer.
func (s *Store) SetBackupPolicy(p *backuppolicy.Policy) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Backup = p
	return s.flush()
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

// firstAppUID is where instance uids start: above every distribution's range
// for human and system accounts, so an app never shares a uid with a login.
const firstAppUID = 20000

/*
EnsureUID returns an instance's uid, allocating the next free one on first
use. Allocated, never derived from the name, so two instances can never share
one: a shared uid would let each read the other's database.
*/
func (s *Store) EnsureUID(key string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := firstAppUID
	idx := -1
	for i, a := range s.state.Apps {
		if a.UID >= next {
			next = a.UID + 1
		}
		if a.Key() == key {
			idx = i
		}
	}
	if idx < 0 {
		return 0, fmt.Errorf("unknown app %q", key)
	}
	if uid := s.state.Apps[idx].UID; uid != 0 {
		return uid, nil
	}
	s.state.Apps[idx].UID = next
	return next, s.flush()
}

// SetMemory records an instance's memory ceiling; zero restores the default.
func (s *Store) SetMemory(key string, bytes int64) error {
	return s.mutate(key, func(a *App) { a.MemoryBytes = bytes })
}

// SetPidsLimit records an instance's process/thread ceiling; zero restores the
// default.
func (s *Store) SetPidsLimit(key string, limit int) error {
	return s.mutate(key, func(a *App) { a.PidsLimit = limit })
}

// SetHostMounts replaces the host paths handed to an instance; nil clears them.
func (s *Store) SetHostMounts(key string, mounts []HostMount) error {
	return s.mutate(key, func(a *App) { a.HostMounts = mounts })
}

// SetRelaxed records which hardening defaults are lifted for an instance.
func (s *Store) SetRelaxed(key string, relaxed []string) error {
	return s.mutate(key, func(a *App) { a.Relaxed = relaxed })
}

// SetHealthCheck records which check last decided an instance was ready.
func (s *Store) SetHealthCheck(key, check string) error {
	return s.mutate(key, func(a *App) { a.HealthCheck = check })
}

// SetHostPort records the host port the live container is published on.
func (s *Store) SetHostPort(key string, port int) error {
	return s.mutate(key, func(a *App) { a.HostPort = port })
}

// SetRuntimeImage records an instance's own runtime image, or clears it.
func (s *Store) SetRuntimeImage(key, image string) error {
	return s.mutate(key, func(a *App) { a.RuntimeImage = image })
}

// RuntimeLocks returns a copy of the resolved runtime image references.
func (s *Store) RuntimeLocks() map[string]string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]string, len(s.state.RuntimeLocks))
	for k, v := range s.state.RuntimeLocks {
		out[k] = v
	}
	return out
}

// SetRuntimeLock records what a runtime image tag resolved to, persisting
// only when it changed.
func (s *Store) SetRuntimeLock(tag, ref string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state.RuntimeLocks[tag] == ref {
		return nil
	}
	if s.state.RuntimeLocks == nil {
		s.state.RuntimeLocks = map[string]string{}
	}
	s.state.RuntimeLocks[tag] = ref
	return s.flush()
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
			// A credential outliving its app would be handed to the next
			// app deployed under the same name, which may not be the same
			// owner.
			delete(s.state.InstanceStorage, key)
			delete(s.state.WideInstanceStorage, key)
			return a, true, s.flush()
		}
	}
	return App{}, false, nil
}

// RegistryMirror returns the Docker Hub mirror, if one is set.
func (s *Store) RegistryMirror() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.state.RegistryMirror
}

// SetRegistryMirror records the Docker Hub mirror; empty clears it.
func (s *Store) SetRegistryMirror(mirror string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.RegistryMirror = mirror
	return s.flush()
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
	if s.state.S3 == nil {
		return false
	}
	if SameCredential(&s.state.S3.S3Target, s.state.Storage) {
		return true
	}
	for _, t := range s.state.InstanceStorage {
		if SameCredential(&s.state.S3.S3Target, t) {
			return true
		}
	}
	return false
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

// SameCredential reports whether two targets hold the same key pair.
func SameCredential(a, b *S3Target) bool {
	if a == nil || b == nil || a.AccessKey == "" {
		return false
	}
	return a.AccessKey == b.AccessKey && a.SecretKey == b.SecretKey
}

// InstanceStorage returns the instance's own upload credential, or nil.
func (s *Store) InstanceStorage(key string) *S3Target {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if t := s.state.InstanceStorage[key]; t != nil {
		copied := *t
		return &copied
	}
	return nil
}

// InstanceStorageWide says whether the instance's own key was stored with
// `--allow-wide-key`.
func (s *Store) InstanceStorageWide(key string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.state.WideInstanceStorage[key]
}

// AllInstanceStorage returns every instance's own credential, copied, keyed
// by "name/env". The isolation probe needs the whole set: a new key has to
// be shown unable to reach each of the others.
func (s *Store) AllInstanceStorage() map[string]S3Target {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]S3Target, len(s.state.InstanceStorage))
	for k, t := range s.state.InstanceStorage {
		if t != nil {
			out[k] = *t
		}
	}
	return out
}

// SetInstanceStorage records (or, with nil, removes) an instance's own upload
// credential. wide says it was stored although its isolation proof failed.
//
// Recording one is refused when the instance no longer exists or another
// instance holds the same key, checked here under the lock: the proof before
// it takes up to two minutes, and a `bay remove` or a second `bay config
// s3:apps` in between would otherwise be undone or doubled.
func (s *Store) SetInstanceStorage(key string, cfg *S3Target, wide bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if cfg != nil {
		exists := false
		for _, a := range s.state.Apps {
			if a.Key() == key {
				exists = true
				break
			}
		}
		if !exists {
			return fmt.Errorf("%s no longer exists", key)
		}
		for other, t := range s.state.InstanceStorage {
			if other != key && SameCredential(t, cfg) {
				return fmt.Errorf("this key is already %s's", other)
			}
		}
	}
	delete(s.state.WideInstanceStorage, key)
	if cfg == nil {
		delete(s.state.InstanceStorage, key)
	} else {
		if s.state.InstanceStorage == nil {
			s.state.InstanceStorage = map[string]*S3Target{}
		}
		copied := *cfg
		s.state.InstanceStorage[key] = &copied
		if wide {
			if s.state.WideInstanceStorage == nil {
				s.state.WideInstanceStorage = map[string]bool{}
			}
			s.state.WideInstanceStorage[key] = true
		}
	}
	return s.flush()
}

// StorageFor is the upload target an instance is given: its own key when it
// has one, else the host-wide `Storage`, else nil (blobs on disk).
func (s *Store) StorageFor(key string) *S3Target {
	if t := s.InstanceStorage(key); t != nil {
		return t
	}
	return s.Storage()
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
		if a.HostPort != 0 {
			used[a.HostPort] = true
		}
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
