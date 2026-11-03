package backup

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/alepha-dev/bay/internal/naming"
)

/*
A bundle is one backup of every SQLite database in an app's `data/` folder:

	apps/<instance>/db/<stamp>/files/<path>.gz    one per database, gzipped
	apps/<instance>/db/<stamp>/manifest.json      uploaded LAST

The manifest is what makes a bundle exist. Its files go first, so a backup
that dies halfway leaves objects without a manifest - an incomplete bundle that
listing skips, restore refuses and retention removes - never a manifest that
promises files the bucket does not hold.

The older single-database shape (`<stamp>.sqlite.gz`, app.db only) stays
listable and restorable next to it, so a bucket filled before bundles keeps
every backup it has.
*/

// ManifestFormat is the version of the manifest layout. A reader refuses a
// format it does not know rather than guessing at its fields.
const ManifestFormat = 1

const (
	manifestName = "manifest.json"
	filesDir     = "files/"
)

// The kinds of stored backup an Entry can be.
const (
	KindBundle = "bundle" // every SQLite file of data/, with a manifest
	KindSQLite = "sqlite" // the older single app.db snapshot
	KindDump   = "dump"   // a stack service's dump
)

// sqliteHeader is the first 16 bytes of every SQLite database file.
var sqliteHeader = []byte("SQLite format 3\x00")

// Manifest describes one bundle: what it holds and what the data looked like.
type Manifest struct {
	Format    int       `json:"format"`
	CreatedAt time.Time `json:"createdAt"`
	App       string    `json:"app"`
	Env       string    `json:"env"`
	Instance  string    `json:"instance"`
	Release   string    `json:"release,omitempty"`
	Trigger   string    `json:"trigger,omitempty"`
	Tag       string    `json:"tag,omitempty"`
	Bay       string    `json:"bay,omitempty"`
	// Encryption is null: bundles are stored as they are. A field rather than
	// an absence, so a reader written later can tell "not encrypted" from "a
	// manifest older than encryption".
	Encryption *string        `json:"encryption"`
	Files      []ManifestFile `json:"files"`
	// Skipped names what was in data/ and deliberately left out (a hidden
	// file or folder, a symbolic link), so its absence from the bundle is
	// stated, not inferred.
	Skipped []string `json:"skipped,omitempty"`
}

// ManifestFile is one database in a bundle.
type ManifestFile struct {
	// Path is relative to data/, with forward slashes.
	Path        string `json:"path"`
	Key         string `json:"key"`
	RawBytes    int64  `json:"rawBytes"`
	StoredBytes int64  `json:"storedBytes"`
	// SHA256 is of the snapshot itself, before compression: what a restore
	// checks once it has unpacked the file.
	SHA256 string `json:"sha256"`
	Inspection
}

// BundleMeta is what the caller knows about a backup that the data does not.
type BundleMeta struct {
	Release string
	Trigger string
	Bay     string
	// Tag goes into the bundle's directory name (see ValidTag), so retention
	// can tell a pre-deploy or labelled backup without opening its manifest.
	Tag string
}

/*
DiscoverSQLite lists the SQLite databases under dataDir, relative to it with
forward slashes, sorted.

A database is recognised by its header, not its name, so whatever an app calls
its files they are found. An empty file counts when its name says database
(`.db`, `.sqlite`, `.sqlite3`): that is what a database looks like before its
first write, and Bay creates `app.db` exactly so.

Left out on purpose:
  - `-wal`, `-shm`, `-journal`: the snapshot reads through them already;
  - `*.before-restore-*`: the copies a restore sets aside, which would
    otherwise be backed up - and restored over the live data - forever;
  - hidden files and folders (`.home`, `.cache`...), reported in `skipped`
    (a folder once, not its contents): a browser's profile and the system's
    key stores live there as SQLite files, and they are neither the app's
    data nor anything a bucket should hold;
  - symbolic links, reported in `skipped`: following one could read another
    app's data into this app's bucket.
*/
func DiscoverSQLite(dataDir string) (files, skipped []string, err error) {
	root, err := filepath.Abs(dataDir)
	if err != nil {
		return nil, nil, err
	}
	err = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if p == root {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				skipped = append(skipped, rel+"/ (hidden folder)")
				return filepath.SkipDir
			}
			skipped = append(skipped, rel+" (hidden file)")
			return nil
		}
		if d.Type()&fs.ModeSymlink != 0 {
			skipped = append(skipped, rel+" (symbolic link)")
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if !d.Type().IsRegular() || !sqliteCandidate(d.Name()) {
			return nil
		}
		ok, err := isSQLite(p)
		if err != nil {
			return err
		}
		if ok {
			files = append(files, rel)
		}
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	sort.Strings(files)
	sort.Strings(skipped)
	return files, skipped, nil
}

func sqliteCandidate(name string) bool {
	for _, suffix := range []string{"-wal", "-shm", "-journal"} {
		if strings.HasSuffix(name, suffix) {
			return false
		}
	}
	return !strings.Contains(name, ".before-restore-")
}

func isSQLite(p string) (bool, error) {
	f, err := os.Open(p)
	if err != nil {
		return false, err
	}
	defer f.Close()
	head := make([]byte, len(sqliteHeader))
	n, err := io.ReadFull(f, head)
	if n == 0 && (err == io.EOF || err == nil) {
		switch strings.ToLower(filepath.Ext(p)) {
		case ".db", ".sqlite", ".sqlite3":
			return true, nil
		}
		return false, nil
	}
	if err != nil && err != io.ErrUnexpectedEOF {
		return false, err
	}
	return bytes.Equal(head[:n], sqliteHeader), nil
}

func bundlePrefix(app, env, stamp string) string {
	return dbPrefix(app, env) + stamp + "/"
}

/*
BackupBundle snapshots every SQLite database in dataDir, verifies each one,
uploads them and then the manifest.

One failing database fails the bundle: a backup that silently holds two of an
app's three databases restores into an app whose data no longer agrees with
itself. What was uploaded before the failure is removed, best effort; what is
left is an incomplete bundle, which nothing reads.
*/
func (m *Manager) BackupBundle(ctx context.Context, app, env string, runtime Interpreter, dataDir string, meta BundleMeta) (*Result, *Manifest, error) {
	files, skipped, err := DiscoverSQLite(dataDir)
	if err != nil {
		return nil, nil, fmt.Errorf("look for databases in %s: %w", dataDir, err)
	}
	if len(files) == 0 {
		return nil, nil, fmt.Errorf("no database to back up: no SQLite file in %s", dataDir)
	}
	if err := ValidTag(meta.Tag); err != nil {
		return nil, nil, err
	}

	tmpDir, err := os.MkdirTemp("", "bay-backup-*")
	if err != nil {
		return nil, nil, err
	}
	defer os.RemoveAll(tmpDir)

	now := time.Now().UTC()
	stamp := now.Format(timeLayout)
	if meta.Tag != "" {
		stamp += "-" + meta.Tag
	}
	prefix := bundlePrefix(app, env, stamp)
	manifest := &Manifest{
		Format: ManifestFormat, CreatedAt: now, App: app, Env: env,
		Instance: naming.Instance(app, env), Release: meta.Release,
		Trigger: meta.Trigger, Tag: meta.Tag, Bay: meta.Bay, Skipped: skipped,
	}
	var uploaded []string
	fail := func(err error) (*Result, *Manifest, error) {
		// A fresh context: the one that failed may be the reason. Newest
		// first, so the manifest goes before the files it vouches for.
		cleanup, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		for i := len(uploaded) - 1; i >= 0; i-- {
			_ = m.store.Delete(cleanup, uploaded[i])
		}
		return nil, nil, err
	}

	for i, rel := range files {
		snapshot := filepath.Join(tmpDir, fmt.Sprintf("%d.sqlite", i))
		inspection, err := Snapshot(ctx, runtime, filepath.Join(dataDir, filepath.FromSlash(rel)), snapshot)
		if err != nil {
			return fail(fmt.Errorf("%s: %w", rel, err))
		}
		packed := snapshot + ".gz"
		raw, sum, err := gzipFileSum(snapshot, packed)
		if err != nil {
			return fail(fmt.Errorf("%s: compress: %w", rel, err))
		}
		// Done with it: the next snapshot must not have to share the disk
		// with every one before it.
		os.Remove(snapshot)
		key := prefix + filesDir + rel + ".gz"
		// Listed before the PUT: a failure that is only the answer getting
		// lost may still have stored the object.
		uploaded = append(uploaded, key)
		stored, err := m.store.PutFile(ctx, key, packed)
		if err != nil {
			return fail(fmt.Errorf("upload %s: %w", key, err))
		}
		os.Remove(packed)
		manifest.Files = append(manifest.Files, ManifestFile{
			Path: rel, Key: key, RawBytes: raw, StoredBytes: stored, SHA256: sum, Inspection: inspection,
		})
	}

	body, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fail(err)
	}
	manifestKey := prefix + manifestName
	// The same goes for the manifest: one left behind by an ambiguous failure
	// would list a backup whose files were just deleted.
	uploaded = append(uploaded, manifestKey)
	if err := m.store.Put(ctx, manifestKey, body); err != nil {
		return fail(fmt.Errorf("upload %s: %w", manifestKey, err))
	}

	res := &Result{Key: manifestKey, Kind: KindBundle}
	for _, f := range manifest.Files {
		res.RawBytes += f.RawBytes
		res.StoredBytes += f.StoredBytes
		res.Tables += f.Tables
		res.Files = append(res.Files, f.Path)
	}
	res.StoredBytes += int64(len(body))
	return res, manifest, nil
}

// Manifest downloads and decodes a bundle's manifest.
func (m *Manager) Manifest(ctx context.Context, key string) (*Manifest, error) {
	body, err := m.store.Get(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("download %s: %w", key, err)
	}
	var man Manifest
	if err := json.Unmarshal(body, &man); err != nil {
		return nil, fmt.Errorf("%s is not a manifest: %w", key, err)
	}
	if man.Format != ManifestFormat {
		return nil, fmt.Errorf("%s has manifest format %d, this Bay reads %d", key, man.Format, ManifestFormat)
	}
	if man.Encryption != nil {
		return nil, fmt.Errorf("%s is encrypted (%s), this Bay cannot read it", key, *man.Encryption)
	}
	return &man, nil
}

// FetchedFile is one database of a fetched bundle, verified, on local disk.
type FetchedFile struct {
	Path  string // relative to data/, forward slashes
	Local string
	// Inspection is what SQLite said of the downloaded file.
	Inspection Inspection
}

// Fetched is a bundle downloaded and verified, waiting to be installed.
type Fetched struct {
	Manifest *Manifest
	Files    []FetchedFile
}

/*
FetchBundle downloads every database of a bundle, checks each against the
manifest's checksum and SQLite's integrity check, and answers them in a
temporary directory the caller removes with cleanup.

All of them or none: one bad file refuses the bundle before anything is
installed, because a restore that puts back two databases out of three is a
new incident, not a recovery.
*/
func (m *Manager) FetchBundle(ctx context.Context, manifestKey string, runtime Interpreter) (*Fetched, func(), error) {
	man, err := m.Manifest(ctx, manifestKey)
	if err != nil {
		return nil, nil, err
	}
	prefix := strings.TrimSuffix(manifestKey, manifestName)
	if len(man.Files) == 0 {
		return nil, nil, fmt.Errorf("%s lists no database", manifestKey)
	}
	dir, err := os.MkdirTemp("", "bay-restore-*")
	if err != nil {
		return nil, nil, err
	}
	cleanup := func() { os.RemoveAll(dir) }

	out := &Fetched{Manifest: man}
	seen := map[string]bool{}
	for i, f := range man.Files {
		// The manifest is data from a bucket: a path in it must stay inside
		// data/, and its key inside this bundle.
		if !safeRelPath(f.Path) || seen[f.Path] {
			cleanup()
			return nil, nil, fmt.Errorf("%s: refusing file path %q", manifestKey, f.Path)
		}
		seen[f.Path] = true
		if f.Key != prefix+filesDir+f.Path+".gz" {
			cleanup()
			return nil, nil, fmt.Errorf("%s: refusing key %q for %s", manifestKey, f.Key, f.Path)
		}
		local := filepath.Join(dir, fmt.Sprintf("%d.sqlite", i))
		sum, err := m.downloadSum(ctx, f.Key, local)
		if err != nil {
			cleanup()
			return nil, nil, err
		}
		if sum != f.SHA256 {
			cleanup()
			return nil, nil, fmt.Errorf("%s: checksum mismatch (manifest %s, got %s)", f.Key, f.SHA256, sum)
		}
		inspection, err := Verify(ctx, runtime, local)
		if err != nil {
			cleanup()
			return nil, nil, fmt.Errorf("verify %s: %w", f.Key, err)
		}
		if !inspection.OK() {
			cleanup()
			return nil, nil, fmt.Errorf("backup %s is corrupt: %s", f.Key, inspection.Integrity)
		}
		out.Files = append(out.Files, FetchedFile{Path: f.Path, Local: local, Inspection: inspection})
	}
	return out, cleanup, nil
}

func safeRelPath(p string) bool {
	if p == "" || strings.HasPrefix(p, "/") || strings.Contains(p, "\\") {
		return false
	}
	clean := path.Clean(p)
	return clean == p && clean != "." && clean != ".." && !strings.HasPrefix(clean, "../")
}

/*
InstallBundle puts every database of a fetched bundle in place under dataDir,
each one through Install (the current file set aside, never deleted).

When one fails, the ones already installed are put back as they were, so the
app is left on the data it had rather than on a mix of two moments. Databases
in dataDir the bundle does not hold are left alone, and named in `untouched`.

The caller must have stopped the app.
*/
func InstallBundle(f *Fetched, dataDir string) (untouched []string, err error) {
	var installed []installedFile
	for _, file := range f.Files {
		live := filepath.Join(dataDir, filepath.FromSlash(file.Path))
		aside, err := install(file.Local, live)
		if err != nil {
			rbErr := rollback(installed)
			var notBack *NotRolledBackError
			if rbErr != nil {
				return nil, &NotRolledBackError{Err: fmt.Errorf("%s: %w; and putting back the databases already restored failed: %v", file.Path, err, rbErr)}
			}
			if errors.As(err, &notBack) {
				return nil, &NotRolledBackError{Err: fmt.Errorf("%s: %w", file.Path, err)}
			}
			return nil, fmt.Errorf("%s: %w", file.Path, err)
		}
		installed = append(installed, installedFile{live, aside})
	}

	present, _, err := DiscoverSQLite(dataDir)
	if err == nil {
		inBundle := map[string]bool{}
		for _, file := range f.Files {
			inBundle[file.Path] = true
		}
		for _, p := range present {
			if !inBundle[p] {
				untouched = append(untouched, p)
			}
		}
	}
	return untouched, nil
}

// installedFile is a database InstallBundle put in place, and where the one it
// replaced was set aside ("" when there was none).
type installedFile struct{ live, aside string }

func rollback(installed []installedFile) error {
	var errs []error
	for i := len(installed) - 1; i >= 0; i-- {
		d := installed[i]
		if err := os.Remove(d.live); err != nil && !os.IsNotExist(err) {
			errs = append(errs, err)
			continue
		}
		if d.aside == "" {
			continue // there was nothing before: removing the restored file is the rollback
		}
		for _, suffix := range []string{"", "-wal", "-shm"} {
			if err := os.Rename(d.aside+suffix, d.live+suffix); err != nil && !os.IsNotExist(err) {
				errs = append(errs, err)
			}
		}
	}
	return errors.Join(errs...)
}

// downloadSum streams an object through gunzip into out and answers the
// sha256 of what it wrote.
func (m *Manager) downloadSum(ctx context.Context, key, out string) (string, error) {
	body, _, err := m.store.Open(ctx, key)
	if err != nil {
		return "", fmt.Errorf("download %s: %w", key, err)
	}
	defer body.Close()
	zr, err := gzip.NewReader(body)
	if err != nil {
		return "", fmt.Errorf("decompress %s: %w", key, err)
	}
	defer zr.Close()
	f, err := os.OpenFile(out, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	if _, err := io.Copy(io.MultiWriter(f, h), zr); err != nil {
		f.Close()
		return "", fmt.Errorf("download %s: %w", key, err)
	}
	if err := f.Close(); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// gzipFileSum is gzipFile that also answers the sha256 of src.
func gzipFileSum(src, dst string) (int64, string, error) {
	in, err := os.Open(src)
	if err != nil {
		return 0, "", err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return 0, "", err
	}
	defer out.Close()
	zw, err := gzip.NewWriterLevel(out, gzip.DefaultCompression)
	if err != nil {
		return 0, "", err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(zw, h), in)
	if err != nil {
		return 0, "", err
	}
	if err := zw.Close(); err != nil {
		return 0, "", err
	}
	return n, hex.EncodeToString(h.Sum(nil)), out.Close()
}

/*
RestoreKey resolves what a restore was given into the key to fetch and its
kind, and refuses one outside this app's prefix: restoring another app's data
is never what a pasted key should do by accident.

A bundle may be named by its manifest, its directory or its stamp alone.
*/
func RestoreKey(app, env, given string) (key, kind string, err error) {
	prefix := dbPrefix(app, env)
	k := strings.TrimSuffix(given, "/")
	if !strings.Contains(k, "/") {
		k = prefix + k
	}
	if !strings.HasPrefix(k, prefix) {
		return "", "", fmt.Errorf("%s is not a backup of %s/%s (its backups are under %s)", given, app, env, prefix)
	}
	rest := strings.TrimPrefix(k, prefix)
	switch {
	case strings.HasSuffix(rest, dumpSuffix):
		return "", "", fmt.Errorf("%s is a service dump, not a database snapshot", given)
	case strings.HasSuffix(rest, ".sqlite.gz") && !strings.Contains(rest, "/"):
		if _, err := parseKeyTime(k); err != nil {
			return "", "", err
		}
		return k, KindSQLite, nil
	}
	stamp := strings.TrimSuffix(rest, "/"+manifestName)
	if _, _, err := parseStamp(stamp); err != nil {
		return "", "", fmt.Errorf("%s is not a backup key", given)
	}
	return prefix + stamp + "/" + manifestName, KindBundle, nil
}
