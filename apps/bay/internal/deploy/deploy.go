// Package deploy turns an app artifact into a running app instance.
//
// The artifact is the tar.gz produced by `alepha pack`: `dist/` (including
// `dist/manifest.json`) plus `migrations/`, and nothing else. Bay consumes the
// framework's existing artifact format rather than a Bay-specific one, so the
// same file deploys to Bay, to Alepha Rocket, or through `alepha platform up
// --prebuilt`.
//
// This is the primitive that must exist in the Go binary itself and never move
// up into anything Bay deploys: it is how those get installed in the first
// place, and how they get repaired when a bad deploy breaks them.
package deploy

import (
	"archive/tar"
	"compress/gzip"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/alepha/bay/internal/manifest"
	"github.com/alepha/bay/internal/runner"
	"github.com/alepha/bay/internal/state"
)

// bayOwnedKeys are the env vars Bay manages. Everything else in a .env belongs
// to the user and must survive a redeploy untouched — otherwise the first
// redeploy silently wipes STRIPE_KEY and the app comes up degraded.
var bayOwnedKeys = []string{
	"NODE_ENV", "DATABASE_URL", "APP_SECRET", "STORAGE_PATH", "DATA_DIR",
	"SERVER_PORT", "SERVER_HOST", "APP_NAME",
	"S3_ENDPOINT", "S3_BUCKET_NAME", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY",
	"S3_REGION", "S3_KEY_PREFIX",
}

// Backend names recorded on state.App.StorageBackend.
const (
	BackendLocal = "local"
	BackendS3    = "s3"
)

// Options describes one deployment.
type Options struct {
	Root     string // bay data root
	Artifact string // path to the tar.gz produced by `alepha pack`
	Name     string
	Env      string
	// Domains override the composed one, canonical first. Left empty, Bay
	// derives <manifest.name>[-<env>].<baseDomain> — so deploying needs no domain
	// argument and no config file anywhere.
	Domains    []string
	BaseDomain string
	Runtime    string // absolute path to the node/bun binary
	// Storage is the bucket hosted apps write blobs to, nil when this Bay has
	// none configured. Handed to an app only when its manifest declares a
	// bucket, and never the credentials backups use.
	Storage *state.S3Target
	// MigratedStorage records that `bay storage migrate` has already copied
	// this app's local files into the bucket, so switching backends will not
	// strand them. Without it a populated `storage/` refuses the switch.
	MigratedStorage bool
	// Secrets are the app's own env vars, delivered WITH this deploy and merged
	// into the instance `.env` during `provision` — before the release is
	// swapped in, and before the process starts.
	//
	// That ordering is the whole point of them being here rather than in a
	// second command. Setting them afterwards means the app boots once without
	// them, and a failure at that step lands after the code already has.
	// Populated from `--secrets-file` by [ConsumeSecretsFile], which has
	// already refused everything in `bayOwnedKeys`.
	//
	// Empty is the normal case. The merge touches only the keys present here,
	// so everything else in the `.env` survives a redeploy exactly as it
	// always has.
	Secrets map[string]string
}

// Result reports what was deployed.
type Result struct {
	App      state.App
	Manifest *manifest.Manifest
	Release  string
	// Previous is the release this app was serving before, empty on a first
	// deploy. Returned rather than left for the caller to read, because `Run`
	// writes the new release into the store as part of its job: a caller that
	// looks it up afterwards gets the release being deployed and silently
	// believes there is nothing to roll back to.
	Previous string
	// DatabasePath is the managed SQLite file, empty when the app brought its
	// own DATABASE_URL.
	DatabasePath string
	// DatabaseCreated is true only when Bay just created an empty database.
	//
	// It is the sole condition under which an automatic restore may run: pulling
	// a backup over a database that already has data would turn an ordinary
	// redeploy into data loss.
	DatabaseCreated bool
	// StorageBackend is where this app's blobs ended up: "local", "s3", or
	// empty when it declares no bucket.
	StorageBackend string
}

// Run unpacks, provisions and registers an app. It does not start it — the
// caller decides, because starting is what needs a health check around it.
func Run(opts Options, store *state.Store) (*Result, error) {
	// Unpacked to a staging directory first: the instance path depends on the
	// name, and the name may come from the manifest, which is inside the archive.
	staging, err := os.MkdirTemp(opts.Root, ".unpack-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(staging)
	// MkdirTemp creates 0700, and this directory becomes the release the app
	// runs from — leaving it that way makes systemd fail at CHDIR with
	// "Permission denied", which names neither the directory nor the mode.
	if err := os.Chmod(staging, 0o755); err != nil {
		return nil, err
	}

	if err := untar(opts.Artifact, staging); err != nil {
		return nil, fmt.Errorf("unpack: %w", err)
	}

	m, err := manifest.LoadFromRelease(staging)
	if err != nil {
		return nil, err
	}

	// One identity per app. `--name` used to key the instance while the domain
	// was composed from the manifest, so `--name demo` on an artifact called
	// `example-bay-app` registered `demo/production` and served it at
	// `example-bay-app.…` — two names for one thing, and neither wrong enough to
	// notice until you try to find it.
	//
	// The artifact still supplies the default; the flag overrides both or
	// neither.
	if opts.Name == "" {
		opts.Name = m.Name
	}
	if opts.Name == "" {
		return nil, fmt.Errorf("artifact declares no project name and no --name was given")
	}

	key := opts.Name + "/" + opts.Env
	existing, isRedeploy := store.Get(key)
	previous := ""
	if isRedeploy {
		previous = existing.Release
	}

	domains := opts.Domains
	if len(domains) == 0 && isRedeploy {
		// A redeploy keeps the domain it is already served on. Recomposing it
		// would silently MOVE a running app whenever someone omitted the flag —
		// the old host would start 404-ing while the registry looked healthy. A
		// domain is changed on purpose or not at all.
		domains = existing.Domains
	}
	if len(domains) == 0 {
		if opts.BaseDomain == "" {
			return nil, fmt.Errorf("no base domain configured; pass --domain or start bay with --base-domain")
		}
		domains = []string{subdomain(opts.Name, opts.Env) + "." + opts.BaseDomain}
	}

	instance := filepath.Join(opts.Root, "apps", opts.Name, opts.Env)
	// Millisecond precision, because a release name has to sort chronologically
	// and a second is not fine enough for CI.
	//
	// At second precision two deploys inside one second collided, and
	// `uniqueRelease` resolved it with a `-2` suffix. That suffix sorts AFTER
	// the bare name, so the pair was still ordered — until a prune deleted the
	// bare name and freed it. The next deploy then took it back, and the newest
	// release sorted as the OLDEST, which is the one thing `Releases` promises
	// never happens. Prune reads that order to decide what to delete.
	//
	// Sub-second precision removes the collision instead of ordering it, and
	// `uniqueRelease` stays as the backstop.
	release := uniqueRelease(instance, time.Now().UTC().Format("2006-01-02-150405.000"))
	releaseDir := filepath.Join(instance, "releases", release)
	if err := os.MkdirAll(filepath.Dir(releaseDir), 0o755); err != nil {
		return nil, err
	}
	if err := os.Rename(staging, releaseDir); err != nil {
		return nil, fmt.Errorf("place release: %w", err)
	}
	// Every refusal below this point (a domain conflict, a static site with
	// secrets, a failed provision) used to leave the renamed directory behind
	// as the newest release: it took a keep slot, the proxy served its files,
	// and the startup prune evicted the real rollback target instead of it.
	placed := false
	defer func() {
		if !placed {
			_ = os.RemoveAll(releaseDir)
		}
	}()

	// Two apps on one domain is not a conflict Bay may resolve by picking: the
	// proxy would route to whichever matched first, so one deploy would silently
	// shadow another and the loser would look deployed while serving nothing.
	//
	// Every hostname is checked, not just the canonical one: a second domain
	// added to an app routes exactly as hard as its first, so an unchecked one
	// would shadow another app just as completely.
	for _, host := range domains {
		if owner, taken := store.ClaimedBy(host); taken && owner != key {
			return nil, fmt.Errorf(
				"domain %s is already served by %s; pass a different --domain, or remove that app first",
				host, owner)
		}
	}
	// A list that repeats itself is a mistake worth naming rather than
	// de-duplicating in silence: it usually means a shell expanded something
	// twice, and the operator should see which value they doubled.
	seen := map[string]bool{}
	for _, host := range domains {
		if seen[host] {
			return nil, fmt.Errorf("domain %s was given twice", host)
		}
		seen[host] = true
	}

	// A static site has no process behind it, so there is nothing to provision:
	// no port to bind, no .env to read, no database to open, no writable
	// directories to grant. Reserving a port would take one out of the pool that
	// nothing will ever listen on, and writing a .env would mint an APP_SECRET
	// whose only effect is to sit at 0600 looking worth stealing.
	//
	// The release placement above already created `releases/`, which is the only
	// directory a static app needs.
	var (
		port           int
		dbPath         string
		dbCreated      bool
		storageBackend string
	)
	if m.IsStatic() && len(opts.Secrets) > 0 {
		// Refused rather than dropped. A static site has no `.env` and no
		// process, so there is nowhere for these to go and nothing that would
		// ever read them — and a deploy that accepted them would report success
		// while silently discarding an app's credentials. The CLI does not send
		// them for a static site; reaching here means somebody passed
		// `--secrets-file` by hand.
		return nil, fmt.Errorf(
			"%s/%s is a static site: it has no process, so it has no environment for the %d value(s) "+
				"in the secrets file. Anything it needs at build time belongs in the artifact",
			opts.Name, opts.Env, len(opts.Secrets))
	}
	if !m.IsStatic() {
		// Kept stable across redeploys, unless the previous record was a static
		// site: its port is 0, and a process app provisioned with
		// `SERVER_PORT=0` binds a random port that the readiness probe never
		// finds.
		if isRedeploy && existing.Port != 0 {
			port = existing.Port
		} else {
			port, err = allocatePort(store.UsedPorts())
			if err != nil {
				return nil, err
			}
		}

		dbPath, dbCreated, storageBackend, err = provision(opts, instance, m, port, existing.StorageBackend)
		if err != nil {
			return nil, fmt.Errorf("provision: %w", err)
		}
	}

	// current -> releases/<release>, swapped atomically via rename.
	current := filepath.Join(instance, "current")
	tmpLink := current + ".tmp"
	_ = os.Remove(tmpLink)
	if err := os.Symlink(releaseDir, tmpLink); err != nil {
		return nil, fmt.Errorf("link release: %w", err)
	}
	if err := os.Rename(tmpLink, current); err != nil {
		return nil, fmt.Errorf("swap current: %w", err)
	}
	placed = true

	app := state.App{
		Name:    opts.Name,
		Env:     opts.Env,
		Domains: domains,
		Release: release,
		Port:    port,
		Runtime: m.Runtime,
		Static:  m.IsStatic(),
		// Only a Bay-provisioned database can be snapshotted; a BYO DATABASE_URL
		// leaves dbPath empty.
		Backups: dbPath != "",
		// Read by the sandbox (whether `storage/` is writable) and by the
		// backup (whether to archive it). Both are wrong if they guess.
		StorageBackend: storageBackend,
		// Carried so an app that serves nobody on purpose — a weekly mailer, a
		// nightly import — can be told apart from one that has been abandoned.
		// Both read as zero traffic; only one of them should be deleted.
		Crons: len(m.Cron),
	}
	if err := store.Upsert(app); err != nil {
		return nil, err
	}
	// Read back what was actually persisted. `Upsert` carries runtime-owned
	// fields forward onto its own copy, so the local literal still holds the
	// zero values — and reporting those made a redeploy claim it had revoked a
	// control-API grant that was in fact intact. A response that contradicts the
	// stored state is worse than no response.
	if saved, ok := store.Get(app.Key()); ok {
		app = saved
	}
	return &Result{
		App: app, Manifest: m, Release: release, Previous: previous,
		DatabasePath: dbPath, DatabaseCreated: dbCreated,
		StorageBackend: storageBackend,
	}, nil
}

// uniqueRelease returns a release name not already taken under this instance.
//
// Bounded rather than looping forever: past a handful of deploys inside one
// second something is wrong upstream, and failing with the ordinary
// already-exists error is better than spinning.
func uniqueRelease(instance, base string) string {
	dir := filepath.Join(instance, "releases")
	if _, err := os.Stat(filepath.Join(dir, base)); os.IsNotExist(err) {
		return base
	}
	for i := 2; i < 100; i++ {
		candidate := fmt.Sprintf("%s-%d", base, i)
		if _, err := os.Stat(filepath.Join(dir, candidate)); os.IsNotExist(err) {
			return candidate
		}
	}
	return base
}

// provision creates the durable, per-instance resources and writes the .env.
//
// These live OUTSIDE the release directory on purpose: they belong to the app
// instance, not to a version, so they survive deploys and rollbacks.
func provision(opts Options, instance string, m *manifest.Manifest, port int, currentBackend string) (dbPath string, dbCreated bool, backend string, err error) {
	dataDir := filepath.Join(instance, "data")
	storageDir := filepath.Join(instance, "storage")
	scratchDir := filepath.Join(instance, "scratch")
	for _, d := range []string{dataDir, storageDir, scratchDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return "", false, "", err
		}
	}

	envPath := filepath.Join(instance, ".env")
	env, err := runner.LoadEnvFile(envPath)
	if err != nil {
		return "", false, "", err
	}

	// The app's own secrets, arriving with this deploy.
	//
	// Merged FIRST, before every Bay-owned assignment below, so Bay's keys
	// overwrite anything that reached here claiming to be one. That cannot
	// happen — `ConsumeSecretsFile` already refuses them by name — which is
	// exactly why the ordering costs nothing and is worth having: the two
	// defences fail independently.
	//
	// And merged here rather than after the deploy, so the process this
	// provision is preparing starts WITH them. There is no boot without them
	// and no second command that could fail once the code has landed.
	for key, value := range opts.Secrets {
		env[key] = value
	}

	// APP_SECRET belongs to the instance, not the release. Regenerating it on
	// every deploy would invalidate every session on every push — a bug that
	// takes weeks to trace back to its cause.
	if env["APP_SECRET"] == "" {
		secret, err := randomHex(32)
		if err != nil {
			return "", false, "", err
		}
		env["APP_SECRET"] = secret
	}

	// Managed vs BYO: a DATABASE_URL supplied by the user wins and Bay steps
	// back entirely — it will not create a SQLite file it does not own.
	if m.Resources.Database && !userSupplied(env, "DATABASE_URL") {
		dbPath = filepath.Join(dataDir, "app.db")
		if _, statErr := os.Stat(dbPath); os.IsNotExist(statErr) {
			f, err := os.OpenFile(dbPath, os.O_CREATE|os.O_WRONLY, 0o600)
			if err != nil {
				return "", false, "", err
			}
			f.Close()
			dbCreated = true
		}
		env["DATABASE_URL"] = "sqlite://" + dbPath
	}
	// Blobs: Bay's bucket, the app's own bucket, or a directory on this disk.
	//
	// The framework picks its backend on `S3_ENDPOINT` alone, so exactly one of
	// the two shapes may be written. Leaving a stale `STORAGE_PATH` next to S3
	// credentials would point at a directory nothing ever writes to, which reads
	// like the files are on disk when they are not.
	if m.Resources.Bucket {
		switch {
		case userSuppliedBucket(env, opts.Storage):
			// BYO bucket wins and Bay steps back entirely, the same way it does
			// for a user-supplied DATABASE_URL. Recorded as s3 because that is
			// where the blobs are — Bay just does not own the bucket.
			backend = BackendS3
			delete(env, "STORAGE_PATH")
		case opts.Storage != nil:
			if err := refuseToStrandFiles(storageDir, opts, currentBackend); err != nil {
				return "", false, "", err
			}
			backend = BackendS3
			env["S3_ENDPOINT"] = opts.Storage.Endpoint
			env["S3_BUCKET_NAME"] = opts.Storage.Bucket
			env["S3_ACCESS_KEY_ID"] = opts.Storage.AccessKey
			env["S3_SECRET_ACCESS_KEY"] = opts.Storage.SecretKey
			env["S3_REGION"] = opts.Storage.Region
			// Bay's own bookkeeping, deliberately NOT `APP_NAME`.
			//
			// `APP_NAME` is the framework's fallback prefix, but an app may set
			// it in code — `Alepha.create` spreads `{...process.env,
			// ...state.env}`, so the in-code value wins — and a prefix Bay
			// cannot be sure of is a prefix Bay cannot migrate, prune or scope
			// a credential to. It also has no room for the environment, and it
			// names the cookie jar, which has nothing to do with blobs.
			//
			// Mirrors the backup key layout so one bucket can hold
			// `apps/<name>/<env>/{db,storage,blobs}/` coherently.
			env["S3_KEY_PREFIX"] = blobPrefix(opts.Name, opts.Env)
			delete(env, "STORAGE_PATH")
		default:
			backend = BackendLocal
			if !userSupplied(env, "STORAGE_PATH") {
				env["STORAGE_PATH"] = storageDir
			}
		}
	}

	// Bay knows the app's identity, so the app never has to be told twice.
	//
	// A DEFAULT, not an override: `Alepha.create` applies in-code env last, so
	// an app that sets APP_NAME itself keeps its own value — which is right,
	// because that value already names its cookies and, on an app deployed
	// elsewhere, its objects.
	//
	// `<name>-<env>` rather than the bare name `subdomain()` uses for
	// production. Hostnames are user-facing and want brevity; this is what
	// `bay status`, `bay logs` and the state key call the instance.
	env["APP_NAME"] = opts.Name + "-" + opts.Env

	// Alepha's local providers default their scratch data to
	// `node_modules/.alepha`, i.e. inside the bundle — which the sandbox keeps
	// read-only and which a redeploy replaces. DATA_DIR moves the whole lot to
	// durable storage outside the release, which is why Bay no longer has to
	// symlink anything into the release directory.
	env["DATA_DIR"] = scratchDir

	env["SERVER_PORT"] = fmt.Sprint(port)
	// Pin to IPv4 loopback: left to itself the runtime resolves "localhost" to
	// ::1 and the proxy dialling 127.0.0.1 gets connection refused.
	env["SERVER_HOST"] = "127.0.0.1"

	/*
		An Alepha bundle already knows it is production — `alepha build`
		replaces `process.env.NODE_ENV` with the literal at build time, so
		`isProduction()` is true and the graceful shutdown drain is on without
		this line. Verified on a running instance before adding it.

		Set anyway, because the OS environment and the bundle's belief should
		not disagree. Anything reading `process.env.NODE_ENV` at runtime rather
		than through the bundle's substitution — a native addon, a dependency
		loaded outside the bundle, a shell dropped into the unit — sees the
		unset variable and concludes development. That is a small class of
		bugs, but a confusing one: half the process thinks it is in production.

		Always "production", including for a `staging` instance. Node's
		convention has three values and staging is not one of them; what Bay
		runs is a built artifact being served to someone.

		Bay-owned, so it cannot be set to something else in the app's .env.
	*/
	env["NODE_ENV"] = "production"

	if err := writeEnvFile(envPath, env); err != nil {
		return "", false, "", err
	}
	return dbPath, dbCreated, backend, nil
}

// RepointStorage rewrites a deployed app's .env to read blobs from the bucket.
//
// Narrower than re-running `provision`, on purpose: a migration must change
// exactly the storage keys and touch nothing else. Re-provisioning would also
// re-derive the port and the database, which are correct already — and any bug
// in that path would land on an app that is only trying to move its files.
//
// The caller stops the app first. Rewriting the environment of a running
// process changes nothing until it restarts, and an app still writing to the
// local directory while its files are being copied is how a migration loses
// the last upload.
func RepointStorage(instance string, name, env string, storage *state.S3Target) error {
	envPath := filepath.Join(instance, ".env")
	values, err := runner.LoadEnvFile(envPath)
	if err != nil {
		return err
	}
	values["S3_ENDPOINT"] = storage.Endpoint
	values["S3_BUCKET_NAME"] = storage.Bucket
	values["S3_ACCESS_KEY_ID"] = storage.AccessKey
	values["S3_SECRET_ACCESS_KEY"] = storage.SecretKey
	values["S3_REGION"] = storage.Region
	values["S3_KEY_PREFIX"] = blobPrefix(name, env)
	// Both would be a lie about where the blobs are: the framework switches
	// backend on S3_ENDPOINT alone, so a leftover STORAGE_PATH points at a
	// directory nothing will write to again.
	delete(values, "STORAGE_PATH")
	return writeEnvFile(envPath, values)
}

// BlobPrefix is where an app instance's blobs live in the storage bucket.
//
// Exported because `bay storage migrate` has to write to exactly the keys the
// app will later read. Two implementations of this string would be one too
// many: the migration would silently copy files somewhere the app never looks,
// and the app would come up healthy serving 404s.
func BlobPrefix(name, env string) string { return blobPrefix(name, env) }

func blobPrefix(name, env string) string {
	return fmt.Sprintf("apps/%s/%s/blobs", name, env)
}

// refuseToStrandFiles blocks a local -> S3 switch that would orphan uploads.
//
// The failure it prevents leaves no trace: the app boots, passes its health
// check and serves 404 for every file uploaded before the switch. Nothing logs
// an error, because nothing went wrong — the app is simply reading an empty
// bucket.
//
// Same discipline as `DatabaseCreated`: a routine redeploy must never be the
// thing that loses data.
func refuseToStrandFiles(storageDir string, opts Options, currentBackend string) error {
	// Only a SWITCH can strand anything. An app already reading from the
	// bucket has had its files dealt with, and the local directory it left
	// behind is leftovers — refusing every subsequent deploy over them would
	// make the migration permanent work rather than a one-off.
	if opts.MigratedStorage || currentBackend == BackendS3 {
		return nil
	}
	empty, err := isEmptyDir(storageDir)
	if err != nil {
		return err
	}
	if empty {
		return nil
	}
	return fmt.Errorf(
		"%s/%s has files in %s that the bucket does not: run `bay storage migrate %s/%s` first, "+
			"or those uploads become unreachable the moment this deploy lands",
		opts.Name, opts.Env, storageDir, opts.Name, opts.Env)
}

// isEmptyDir reports whether a directory tree holds no regular file.
//
// Walked rather than read one level deep: `$storage` puts every blob under a
// container directory, so the top level is never empty once an app has taken a
// single upload, and a one-level check would call it empty exactly when it is
// not.
func isEmptyDir(dir string) (bool, error) {
	empty := true
	err := filepath.WalkDir(dir, func(_ string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		empty = false
		return filepath.SkipAll
	})
	if os.IsNotExist(err) {
		return true, nil
	}
	return empty, err
}

// subdomain composes the host label for an app instance.
//
// Production keeps the bare name so the common case reads well; every other
// environment is suffixed, so staging never collides with production on the
// same base domain.
func subdomain(name, env string) string {
	if env == "" || env == "production" {
		return name
	}
	return name + "-" + env
}

// userSupplied reports whether a key was set by the user rather than by Bay.
// Bay-written keys are recognisable because Bay wrote them; any pre-existing
// non-Bay-shaped value is treated as the user's.
func userSupplied(env map[string]string, key string) bool {
	v, ok := env[key]
	if !ok || v == "" {
		return false
	}
	if key == "DATABASE_URL" {
		return !strings.HasPrefix(v, "sqlite://")
	}
	return false
}

// userSuppliedBucket reports whether the app brought its own object storage.
//
// Separate from `userSupplied` because the answer depends on what Bay itself
// would have written: a value equal to Bay's configured endpoint IS Bay's,
// left over from an earlier deploy, and treating it as the user's would freeze
// the app on a bucket the operator has since moved.
//
// With no storage configured, any endpoint present can only have come from the
// user — Bay has never had one to write.
func userSuppliedBucket(env map[string]string, storage *state.S3Target) bool {
	v := env["S3_ENDPOINT"]
	if v == "" {
		return false
	}
	if storage == nil {
		return true
	}
	return v != storage.Endpoint
}

// writeEnvFile writes atomically with 0600 — a torn .env means the app boots
// with half its configuration.
func writeEnvFile(path string, env map[string]string) error {
	keys := make([]string, 0, len(env))
	for k := range env {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	b.WriteString("# Managed by Bay. Keys below are Bay-owned; anything else is yours.\n")
	b.WriteString("# Bay-owned: " + strings.Join(bayOwnedKeys, ", ") + "\n\n")
	for _, k := range keys {
		// Quoted, because this file is ALSO read by systemd as an
		// EnvironmentFile, whose grammar eats backslashes and honours quotes.
		// See runner.QuoteEnvValue.
		fmt.Fprintf(&b, "%s=%s\n", k, runner.QuoteEnvValue(env[k]))
	}

	tmp, err := os.CreateTemp(filepath.Dir(path), ".env-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.WriteString(b.String()); err != nil {
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
	return os.Rename(tmp.Name(), path)
}

func randomHex(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// allocatePort asks the kernel for a free port, avoiding ones already claimed.
func allocatePort(used map[int]bool) (int, error) {
	for attempt := 0; attempt < 50; attempt++ {
		l, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return 0, err
		}
		port := l.Addr().(*net.TCPAddr).Port
		l.Close()
		if !used[port] {
			return port, nil
		}
	}
	return 0, fmt.Errorf("no free port found")
}

// maxEntrySize caps a single extracted file.
//
// Without a ceiling, a crafted archive of a few kilobytes can expand to fill
// the disk — and a full disk on Bay's machine takes down every app, not just
// the one being deployed. Generous enough for any real bundle; the point is
// that a bound exists.
const maxEntrySize = 512 << 20 // 512 MiB

// untar extracts a gzipped tar, refusing anything that could write outside the
// destination.
//
// This is the artifact `alepha pack` produces — `dist/` + `migrations/`, all
// regular files and directories. Anything else in the stream is refused rather
// than skipped: a symlink or hard link is the standard tar escape (point one at
// /etc, then write "through" it on a later entry), and a device node or setuid
// bit has no business in an application bundle. Refusing outright is both safer
// and simpler than trying to decide which links are benign.
func untar(src, dest string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("not a gzip archive: %w", err)
	}
	defer gz.Close()

	if err := os.MkdirAll(dest, 0o755); err != nil {
		return err
	}
	root := filepath.Clean(dest)

	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("read archive: %w", err)
		}

		// An absolute path or a `..` element would place the file outside the
		// release directory — as root, and before any sandbox applies.
		name := filepath.Clean(filepath.FromSlash(hdr.Name))
		if filepath.IsAbs(name) || name == ".." || strings.HasPrefix(name, ".."+string(os.PathSeparator)) {
			return fmt.Errorf("archive entry escapes destination: %s", hdr.Name)
		}
		target := filepath.Join(root, name)
		// Belt and braces: Join already cleans, but the prefix check is what
		// actually proves containment.
		if target != root && !strings.HasPrefix(target, root+string(os.PathSeparator)) {
			return fmt.Errorf("archive entry escapes destination: %s", hdr.Name)
		}

		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if hdr.Size > maxEntrySize {
				return fmt.Errorf("archive entry %s is %d bytes, over the %d limit", hdr.Name, hdr.Size, maxEntrySize)
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			if err := writeEntry(tr, target, hdr.Size); err != nil {
				return err
			}
		case tar.TypeXGlobalHeader, tar.TypeXHeader:
			// pax metadata, carries no file content.
			continue
		default:
			return fmt.Errorf(
				"archive entry %s has unsupported type %q; an app bundle must contain only regular files and directories",
				hdr.Name, string(rune(hdr.Typeflag)),
			)
		}
	}
}

// writeEntry copies one file, refusing to read past its declared size.
//
// The mode is deliberately NOT taken from the archive: the release tree is
// root-owned and read-only to the app, and honouring a setuid bit out of an
// uploaded tarball would be a privilege-escalation primitive.
func writeEntry(tr *tar.Reader, target string, size int64) error {
	out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()
	// LimitReader bounds the copy at the header's declared size, so a stream
	// that keeps producing data cannot exceed what the entry claimed.
	if _, err := io.Copy(out, io.LimitReader(tr, size)); err != nil {
		return err
	}
	return out.Close()
}
