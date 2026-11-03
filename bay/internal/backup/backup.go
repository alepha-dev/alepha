// Package backup snapshots app databases to S3 and puts them back.
//
// Scope is deliberately narrow: the SQLite databases of data/ only. Not `storage/`, not
// `.env`, not Bay's own state. The database is the irreplaceable part; the rest
// is either reproducible from the developer's machine (secrets live in
// `.env.<env>` there already) or explicitly out of scope — and what is out of
// scope must be *shown*, never inferred.
package backup

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/alepha-dev/bay/internal/s3"

	"github.com/alepha-dev/bay/internal/naming"
)

// timeLayout sorts lexically in chronological order, which is what makes
// "latest" a listing concern rather than a pointer that can go stale.
const timeLayout = "20060102T150405Z"

// Manager performs backups for one Bay installation.
type Manager struct {
	store *s3.Client
}

func New(client *s3.Client) *Manager { return &Manager{store: client} }

// Entry is one stored backup.
type Entry struct {
	// Key is what a restore names: a bundle's manifest, or the object itself
	// for the older single-file shapes.
	Key       string
	Timestamp time.Time
	// Size is every object of the backup together.
	Size int64
	Kind string
	// Files is how many databases a bundle holds; 1 for the other kinds.
	Files int
	// Tag is what follows the stamp in a bundle's directory name: TagPreDeploy,
	// an operator's own label, or nothing for a scheduled or manual backup.
	Tag string

	objects []string // every key to delete to remove this backup
}

// Result reports what a backup did, so the caller can print it rather than
// leave the operator guessing.
type Result struct {
	Key         string
	Kind        string
	Files       []string // a bundle's databases, relative to data/
	RawBytes    int64
	StoredBytes int64
	Tables      int
}

func dbPrefix(app, env string) string {
	return "apps/" + naming.Instance(app, env) + "/db/"
}

// Backup snapshots the live database, verifies it, compresses it and uploads it.
func (m *Manager) Backup(ctx context.Context, app, env string, runtime Interpreter, livePath string) (*Result, error) {
	if _, err := os.Stat(livePath); err != nil {
		return nil, fmt.Errorf("no database at %s: %w", livePath, err)
	}

	// A unique temp path, never derived from caller input: an earlier off-by-one
	// in argument handling aimed a VACUUM target at the live database.
	tmpDir, err := os.MkdirTemp("", "bay-backup-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmpDir)
	snapshot := filepath.Join(tmpDir, "snapshot.sqlite")

	inspection, err := Snapshot(ctx, runtime, livePath, snapshot)
	if err != nil {
		return nil, err
	}

	// File to file, then a streamed upload: the database never sits in
	// memory, so its size is bounded by the disk, not by Bay's RAM.
	packed := snapshot + ".gz"
	rawBytes, err := gzipFile(snapshot, packed)
	if err != nil {
		return nil, fmt.Errorf("compress: %w", err)
	}

	key := dbPrefix(app, env) + time.Now().UTC().Format(timeLayout) + ".sqlite.gz"
	stored, err := m.store.PutFile(ctx, key, packed)
	if err != nil {
		return nil, fmt.Errorf("upload %s: %w", key, err)
	}
	return &Result{
		Key:         key,
		Kind:        KindSQLite,
		Files:       []string{"app.db"},
		RawBytes:    rawBytes,
		StoredBytes: stored,
		Tables:      inspection.Tables,
	}, nil
}

// List returns the complete backups for an app, newest first.
func (m *Manager) List(ctx context.Context, app, env string) ([]Entry, error) {
	complete, _, err := m.list(ctx, app, env)
	return complete, err
}

/*
list reads the instance's prefix and groups it into backups: bundles by their
stamp directory, the older shapes one object each. Bundles without a manifest
come back separately: they are what a backup that died halfway left, and
nothing may restore them.
*/
func (m *Manager) list(ctx context.Context, app, env string) (complete, incomplete []Entry, err error) {
	prefix := dbPrefix(app, env)
	objects, err := m.store.List(ctx, prefix)
	if err != nil {
		return nil, nil, err
	}
	type bundle struct {
		entry    Entry
		manifest bool
	}
	bundles := map[string]*bundle{}
	for _, o := range objects {
		rest := strings.TrimPrefix(o.Key, prefix)
		if stamp, inside, ok := strings.Cut(rest, "/"); ok {
			ts, tag, err := parseStamp(stamp)
			if err != nil {
				continue // ignore anything that is not one of ours
			}
			b := bundles[stamp]
			if b == nil {
				b = &bundle{entry: Entry{Key: prefix + stamp + "/" + manifestName, Timestamp: ts, Kind: KindBundle, Tag: tag}}
				bundles[stamp] = b
			}
			b.entry.Size += o.Size
			b.entry.objects = append(b.entry.objects, o.Key)
			switch {
			case inside == manifestName:
				b.manifest = true
			case strings.HasPrefix(inside, filesDir):
				b.entry.Files++
			}
			continue
		}
		ts, err := parseKeyTime(o.Key)
		if err != nil {
			continue
		}
		kind := KindSQLite
		if strings.HasSuffix(o.Key, dumpSuffix) {
			kind = KindDump
		}
		complete = append(complete, Entry{Key: o.Key, Timestamp: ts, Size: o.Size, Kind: kind, Files: 1, objects: []string{o.Key}})
	}
	for _, b := range bundles {
		if b.manifest {
			complete = append(complete, b.entry)
		} else {
			incomplete = append(incomplete, b.entry)
		}
	}
	newestFirst := func(e []Entry) {
		sort.Slice(e, func(i, j int) bool { return e[i].Timestamp.After(e[j].Timestamp) })
	}
	newestFirst(complete)
	newestFirst(incomplete)
	return complete, incomplete, nil
}

// Latest returns the most recent backup, or false when there is none.
func (m *Manager) Latest(ctx context.Context, app, env string) (Entry, bool, error) {
	entries, err := m.List(ctx, app, env)
	if err != nil {
		return Entry{}, false, err
	}
	if len(entries) == 0 {
		return Entry{}, false, nil
	}
	return entries[0], true, nil
}

// Fetch downloads a backup, decompresses it and verifies it, returning the path
// to a temporary file the caller owns.
//
// Verification happens before the file is put anywhere near the app: restoring
// a corrupt backup over a working database would turn a recoverable incident
// into data loss.
func (m *Manager) Fetch(ctx context.Context, key string, runtime Interpreter) (path string, cleanup func(), err error) {
	path, _, cleanup, err = m.fetch(ctx, key, runtime)
	return path, cleanup, err
}

func (m *Manager) fetch(ctx context.Context, key string, runtime Interpreter) (path string, inspection Inspection, cleanup func(), err error) {
	dir, err := os.MkdirTemp("", "bay-restore-*")
	if err != nil {
		return "", Inspection{}, nil, err
	}
	cleanup = func() { os.RemoveAll(dir) }

	out := filepath.Join(dir, "restored.sqlite")
	if err := m.download(ctx, key, out); err != nil {
		cleanup()
		return "", Inspection{}, nil, err
	}
	inspection, err = Verify(ctx, runtime, out)
	if err != nil {
		cleanup()
		return "", Inspection{}, nil, fmt.Errorf("verify %s: %w", key, err)
	}
	if !inspection.OK() {
		cleanup()
		return "", Inspection{}, nil, fmt.Errorf("backup %s is corrupt: %s", key, inspection.Integrity)
	}
	return out, inspection, cleanup, nil
}

// Install puts a fetched database in place.
//
// The caller must have stopped the app first: replacing the file under a running
// process is how you get a half-written database.
func Install(restored, livePath string) error {
	_, err := install(restored, livePath)
	return err
}

// install is Install answering where the replaced database was set aside, ""
// when there was none.
func install(restored, livePath string) (aside string, err error) {
	if err := os.MkdirAll(filepath.Dir(livePath), 0o755); err != nil {
		return "", err
	}

	// The copy goes to a file of its own first: a copy that fails half way
	// (disk full) must never leave a truncated database where the app looks.
	tmp := livePath + ".restoring"
	if err := copyFileSync(restored, tmp); err != nil {
		os.Remove(tmp)
		return "", err
	}

	// Keep whatever was there. A restore is a destructive act and the operator
	// may have picked the wrong timestamp.
	if _, err := os.Stat(livePath); err == nil {
		aside = livePath + ".before-restore-" + time.Now().UTC().Format(timeLayout)
		if err := os.Rename(livePath, aside); err != nil {
			os.Remove(tmp)
			return "", fmt.Errorf("set aside existing database: %w", err)
		}
		// The WAL and SHM belong to the database just set aside: an app killed
		// at the end of its grace period leaves committed frames in the WAL,
		// and deleting it dropped them from the only safety copy. They follow
		// the file under its new name, where SQLite looks for them.
		for _, suffix := range []string{"-wal", "-shm"} {
			if err := os.Rename(livePath+suffix, aside+suffix); err != nil && !os.IsNotExist(err) {
				return "", undoInstall(tmp, aside, livePath, fmt.Errorf("set aside %s: %w", livePath+suffix, err))
			}
		}
	}

	// A stale write-ahead log next to a fresh database is worse than either
	// alone: SQLite would replay it onto pages it does not belong to.
	for _, sidecar := range []string{livePath + "-wal", livePath + "-shm"} {
		if err := os.Remove(sidecar); err != nil && !os.IsNotExist(err) {
			return "", undoInstall(tmp, aside, livePath, fmt.Errorf("remove %s: %w", sidecar, err))
		}
	}
	if err := os.Rename(tmp, livePath); err != nil {
		return "", undoInstall(tmp, aside, livePath, err)
	}
	return aside, nil
}

// undoInstall puts back what install had set aside, so a refused install
// leaves the data directory as it found it. The error says when it could not.
func undoInstall(tmp, aside, livePath string, cause error) error {
	os.Remove(tmp)
	if aside == "" {
		return cause
	}
	var errs []error
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if err := os.Rename(aside+suffix, livePath+suffix); err != nil && !os.IsNotExist(err) {
			errs = append(errs, err)
		}
	}
	if err := errors.Join(errs...); err != nil {
		return &NotRolledBackError{Err: fmt.Errorf("%w; and putting the database back failed: %v", cause, err)}
	}
	return cause
}

/*
NotRolledBackError is an install that failed and could not put back what it
had already replaced: the data directory is in neither state, so the app must
not be started on it.
*/
type NotRolledBackError struct{ Err error }

func (e *NotRolledBackError) Error() string { return e.Err.Error() }
func (e *NotRolledBackError) Unwrap() error { return e.Err }

func copyFileSync(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	// dst sits in a folder the app writes to, so it may have planted a symlink
	// there: opening it would write through it, as root, anywhere on the host.
	// The name is removed (a symlink itself, never its target) and created
	// anew; O_EXCL refuses one planted in between.
	if err := os.Remove(dst); err != nil && !os.IsNotExist(err) {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

/*
Prune applies the retention rules: it deletes what Plan says goes, and returns
it so the caller can report it — retention that happens invisibly is
indistinguishable from backups going missing.

Rules that keep nothing in particular are refused rather than read as "keep
only the newest": the caller is expected to skip pruning altogether then.
*/
func (m *Manager) Prune(ctx context.Context, app, env string, rules Rules) ([]Entry, error) {
	plan, err := m.Plan(ctx, app, env, rules, time.Now())
	if err != nil {
		return nil, err
	}
	var removed []Entry
	for _, d := range plan {
		if d.Keep {
			continue
		}
		e := d.Entry
		// The manifest first, then the files: a bundle interrupted halfway
		// through deletion is an incomplete one, which nothing restores and
		// the next prune finishes, never a manifest pointing at holes.
		objects := append([]string(nil), e.objects...)
		sort.SliceStable(objects, func(i, j int) bool {
			return strings.HasSuffix(objects[i], "/"+manifestName) && !strings.HasSuffix(objects[j], "/"+manifestName)
		})
		for _, key := range objects {
			if err := m.store.Delete(ctx, key); err != nil {
				return removed, fmt.Errorf("delete %s: %w", key, err)
			}
		}
		removed = append(removed, e)
	}
	return removed, nil
}

// Plan says, for every stored backup, whether the rules keep it and why,
// without deleting anything.
func (m *Manager) Plan(ctx context.Context, app, env string, rules Rules, now time.Time) ([]Decision, error) {
	if err := rules.check(); err != nil {
		return nil, err
	}
	complete, incomplete, err := m.list(ctx, app, env)
	if err != nil {
		return nil, err
	}
	return PlanRetention(complete, incomplete, rules, now), nil
}

func parseKeyTime(key string) (time.Time, error) {
	base := filepath.Base(key)
	stamp := strings.TrimSuffix(strings.TrimSuffix(base, ".sqlite.gz"), dumpSuffix)
	if stamp == base {
		return time.Time{}, fmt.Errorf("not a backup key: %s", key)
	}
	return time.Parse(timeLayout, stamp)
}

// download streams a backup from the bucket through gunzip into out.
func (m *Manager) download(ctx context.Context, key, out string) error {
	body, _, err := m.store.Open(ctx, key)
	if err != nil {
		return fmt.Errorf("download %s: %w", key, err)
	}
	defer body.Close()
	zr, err := gzip.NewReader(body)
	if err != nil {
		return fmt.Errorf("decompress %s: %w", key, err)
	}
	defer zr.Close()
	f, err := os.OpenFile(out, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, zr); err != nil {
		f.Close()
		return fmt.Errorf("download %s: %w", key, err)
	}
	return f.Close()
}

// gzipFile compresses src into dst and returns the size of src.
func gzipFile(src, dst string) (int64, error) {
	in, err := os.Open(src)
	if err != nil {
		return 0, err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return 0, err
	}
	defer out.Close()
	// Default rather than best compression: on a database of gigabytes the
	// last few percent cost minutes of CPU on a small VPS.
	zw, err := gzip.NewWriterLevel(out, gzip.DefaultCompression)
	if err != nil {
		return 0, err
	}
	n, err := io.Copy(zw, in)
	if err != nil {
		return 0, err
	}
	if err := zw.Close(); err != nil {
		return 0, err
	}
	return n, out.Close()
}

func gzipBytes(raw []byte) ([]byte, error) {
	var buf bytes.Buffer
	zw, err := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	if err != nil {
		return nil, err
	}
	if _, err := zw.Write(raw); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func gunzipBytes(packed []byte) ([]byte, error) {
	zr, err := gzip.NewReader(bytes.NewReader(packed))
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	return io.ReadAll(zr)
}
