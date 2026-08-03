// Package deploy turns an app artifact into a running app instance.
//
// The artifact is the tar.gz produced by `alepha pack`: `dist/` (including
// `dist/manifest.json`) plus `migrations/`, and nothing else. Bay consumes the
// framework's existing artifact format rather than a Bay-specific one, so the
// same file deploys to Bay, to Alepha Rocket, or through `alepha platform up
// --prebuilt`.
//
// This is the primitive that must exist in bay-go itself and never move up into
// bay-ui: it is how bay-ui gets installed in the first place, and how it gets
// repaired when a bad deploy breaks it.
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
var bayOwnedKeys = []string{"NODE_ENV", "DATABASE_URL", "APP_SECRET", "STORAGE_PATH", "DATA_DIR", "SERVER_PORT", "SERVER_HOST"}

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
	// AllowControlAPI grants the app access to Bay's control API. Operator-only:
	// see state.App.ControlAPI for why the manifest may not decide this.
	AllowControlAPI bool
	Runtime         string // absolute path to the node/bun binary
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
	// Second resolution, because a release name is something an operator types
	// into `bay rollback` — but two deploys within the same second would then
	// collide, and the failure was a bare `rename: file exists` naming two
	// temporary paths. Suffixed only when it actually collides, so the common
	// name stays clean.
	release := uniqueRelease(instance, time.Now().UTC().Format("2006-01-02-150405"))
	releaseDir := filepath.Join(instance, "releases", release)
	if err := os.MkdirAll(filepath.Dir(releaseDir), 0o755); err != nil {
		return nil, err
	}
	if err := os.Rename(staging, releaseDir); err != nil {
		return nil, fmt.Errorf("place release: %w", err)
	}

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

	port, err := allocatePort(store.UsedPorts())
	if err != nil {
		return nil, err
	}
	if isRedeploy {
		port = existing.Port // keep the port stable across redeploys
	}

	dbPath, dbCreated, err := provision(instance, m, port)
	if err != nil {
		return nil, fmt.Errorf("provision: %w", err)
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

	app := state.App{
		Name:    opts.Name,
		Env:     opts.Env,
		Domains: domains,
		Release: release,
		Port:    port,
		Runtime: m.Runtime,
		// Only a Bay-provisioned database can be snapshotted; a BYO DATABASE_URL
		// leaves dbPath empty.
		Backups: dbPath != "",
		// Carried so an app that serves nobody on purpose — a weekly mailer, a
		// nightly import — can be told apart from one that has been abandoned.
		// Both read as zero traffic; only one of them should be deleted.
		Crons: len(m.Cron),
	}
	// Preserved across redeploys unless the caller asks again: revoking should be
	// deliberate, not a side effect of forgetting a flag. `Upsert` carries the
	// existing value forward, so only an explicit grant flips it on.
	if opts.AllowControlAPI {
		app.ControlAPI = true
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
func provision(instance string, m *manifest.Manifest, port int) (dbPath string, dbCreated bool, err error) {
	dataDir := filepath.Join(instance, "data")
	storageDir := filepath.Join(instance, "storage")
	scratchDir := filepath.Join(instance, "scratch")
	for _, d := range []string{dataDir, storageDir, scratchDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return "", false, err
		}
	}

	envPath := filepath.Join(instance, ".env")
	env, err := runner.LoadEnvFile(envPath)
	if err != nil {
		return "", false, err
	}

	// APP_SECRET belongs to the instance, not the release. Regenerating it on
	// every deploy would invalidate every session on every push — a bug that
	// takes weeks to trace back to its cause.
	if env["APP_SECRET"] == "" {
		secret, err := randomHex(32)
		if err != nil {
			return "", false, err
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
				return "", false, err
			}
			f.Close()
			dbCreated = true
		}
		env["DATABASE_URL"] = "sqlite://" + dbPath
	}
	if m.Resources.Bucket && !userSupplied(env, "STORAGE_PATH") {
		env["STORAGE_PATH"] = storageDir
	}

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
		return "", false, err
	}
	return dbPath, dbCreated, nil
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
// Bay-written keys are recognisable because Bay wrote them; in the PoC we treat
// any pre-existing non-Bay-shaped value as the user's.
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
		fmt.Fprintf(&b, "%s=%s\n", k, env[k])
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
