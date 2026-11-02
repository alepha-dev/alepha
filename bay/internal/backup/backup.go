// Package backup snapshots app databases to S3 and puts them back.
//
// Scope is deliberately narrow: the SQLite database only. Not `storage/`, not
// `.env`, not Bay's own state. The database is the irreplaceable part; the rest
// is either reproducible from the developer's machine (secrets live in
// `.env.<env>` there already) or explicitly out of scope — and what is out of
// scope must be *shown*, never inferred.
package backup

import (
	"bytes"
	"compress/gzip"
	"context"
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
	Key       string
	Timestamp time.Time
	Size      int64
}

// Result reports what a backup did, so the caller can print it rather than
// leave the operator guessing.
type Result struct {
	Key         string
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
		RawBytes:    rawBytes,
		StoredBytes: stored,
		Tables:      inspection.Tables,
	}, nil
}

// List returns the backups for an app, newest first.
func (m *Manager) List(ctx context.Context, app, env string) ([]Entry, error) {
	objects, err := m.store.List(ctx, dbPrefix(app, env))
	if err != nil {
		return nil, err
	}
	entries := make([]Entry, 0, len(objects))
	for _, o := range objects {
		ts, err := parseKeyTime(o.Key)
		if err != nil {
			continue // ignore anything that is not one of ours
		}
		entries = append(entries, Entry{Key: o.Key, Timestamp: ts, Size: o.Size})
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Timestamp.After(entries[j].Timestamp)
	})
	return entries, nil
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
	dir, err := os.MkdirTemp("", "bay-restore-*")
	if err != nil {
		return "", nil, err
	}
	cleanup = func() { os.RemoveAll(dir) }

	out := filepath.Join(dir, "restored.sqlite")
	if err := m.download(ctx, key, out); err != nil {
		cleanup()
		return "", nil, err
	}
	inspection, err := Verify(ctx, runtime, out)
	if err != nil {
		cleanup()
		return "", nil, fmt.Errorf("verify %s: %w", key, err)
	}
	if !inspection.OK() {
		cleanup()
		return "", nil, fmt.Errorf("backup %s is corrupt: %s", key, inspection.Integrity)
	}
	return out, cleanup, nil
}

// Install puts a fetched database in place.
//
// The caller must have stopped the app first: replacing the file under a running
// process is how you get a half-written database.
func Install(restored, livePath string) error {
	if err := os.MkdirAll(filepath.Dir(livePath), 0o755); err != nil {
		return err
	}

	// Keep whatever was there. A restore is a destructive act and the operator
	// may have picked the wrong timestamp.
	if _, err := os.Stat(livePath); err == nil {
		aside := livePath + ".before-restore-" + time.Now().UTC().Format(timeLayout)
		if err := os.Rename(livePath, aside); err != nil {
			return fmt.Errorf("set aside existing database: %w", err)
		}
		// The WAL and SHM belong to the database just set aside: an app killed
		// at the end of its grace period leaves committed frames in the WAL,
		// and deleting it dropped them from the only safety copy. They follow
		// the file under its new name, where SQLite looks for them.
		for _, suffix := range []string{"-wal", "-shm"} {
			if err := os.Rename(livePath+suffix, aside+suffix); err != nil && !os.IsNotExist(err) {
				return fmt.Errorf("set aside %s: %w", livePath+suffix, err)
			}
		}
	}

	// A stale write-ahead log next to a fresh database is worse than either
	// alone: SQLite would replay it onto pages it does not belong to.
	for _, sidecar := range []string{livePath + "-wal", livePath + "-shm"} {
		if err := os.Remove(sidecar); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove %s: %w", sidecar, err)
		}
	}

	in, err := os.Open(restored)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(livePath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}

// Prune keeps the newest `keep` backups and deletes the rest.
//
// Returns what it removed so the caller can report it: retention that happens
// invisibly is indistinguishable from backups going missing.
func (m *Manager) Prune(ctx context.Context, app, env string, keep int) ([]Entry, error) {
	if keep < 1 {
		return nil, fmt.Errorf("keep must be at least 1, got %d", keep)
	}
	entries, err := m.List(ctx, app, env)
	if err != nil {
		return nil, err
	}
	if len(entries) <= keep {
		return nil, nil
	}
	var removed []Entry
	for _, e := range entries[keep:] {
		if err := m.store.Delete(ctx, e.Key); err != nil {
			return removed, fmt.Errorf("delete %s: %w", e.Key, err)
		}
		removed = append(removed, e)
	}
	return removed, nil
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
