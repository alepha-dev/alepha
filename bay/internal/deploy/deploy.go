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
var bayOwnedKeys = []string{"DATABASE_URL", "APP_SECRET", "STORAGE_PATH", "DATA_DIR", "SERVER_PORT", "SERVER_HOST"}

// Options describes one deployment.
type Options struct {
	Root     string // bay data root
	Artifact string // path to the tar.gz produced by `alepha pack`
	Name     string
	Env      string
	// Domain overrides the composed one. Left empty, Bay derives
	// <manifest.name>[-<env>].<baseDomain> — so deploying needs no domain
	// argument and no config file anywhere.
	Domain     string
	BaseDomain string
	Runtime    string // absolute path to the node/bun binary
}

// Result reports what was deployed.
type Result struct {
	App      state.App
	Manifest *manifest.Manifest
	Release  string
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
	instance := filepath.Join(opts.Root, "apps", opts.Name, opts.Env)
	release := time.Now().UTC().Format("2006-01-02-150405")
	releaseDir := filepath.Join(instance, "releases", release)

	if err := untar(opts.Artifact, releaseDir); err != nil {
		return nil, fmt.Errorf("unpack: %w", err)
	}

	m, err := manifest.LoadFromRelease(releaseDir)
	if err != nil {
		return nil, err
	}

	domain := opts.Domain
	if domain == "" {
		if m.Name == "" {
			return nil, fmt.Errorf("manifest has no name and no --domain was given")
		}
		if opts.BaseDomain == "" {
			return nil, fmt.Errorf("no base domain configured; pass --domain or start bay with --base-domain")
		}
		domain = m.Subdomain(opts.Env) + "." + opts.BaseDomain
	}

	port, err := allocatePort(store.UsedPorts())
	if err != nil {
		return nil, err
	}
	if existing, ok := store.Get(opts.Name + "/" + opts.Env); ok {
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
		Domain:  domain,
		Release: release,
		Port:    port,
		Runtime: m.Runtime,
		// Only a Bay-provisioned database can be snapshotted; a BYO DATABASE_URL
		// leaves dbPath empty.
		Backups: dbPath != "",
	}
	if err := store.Upsert(app); err != nil {
		return nil, err
	}
	return &Result{
		App: app, Manifest: m, Release: release,
		DatabasePath: dbPath, DatabaseCreated: dbCreated,
	}, nil
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

	if err := writeEnvFile(envPath, env); err != nil {
		return "", false, err
	}
	return dbPath, dbCreated, nil
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
