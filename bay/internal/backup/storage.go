package backup

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// storagePrefix is where an app's uploaded files are stored, kept separate from
// the database prefix so listing, pruning and restoring never mix the two.
func storagePrefix(app, env string) string {
	return fmt.Sprintf("apps/%s/%s/storage/", app, env)
}

// maxStorageBytes bounds one storage archive.
//
// A gigabyte, held in memory because the S3 client takes a byte slice. That is
// the honest limit of this implementation, and it is enforced rather than
// discovered: an app that grew past it must be told its files are NOT being
// backed up, not silently left with a truncated archive or an out-of-memory
// supervisor that takes every other app down with it.
const maxStorageBytes int64 = 1 << 30

// BackupStorage archives an app's uploaded files and uploads them.
//
// Separate from the database backup rather than folded into it, for two
// reasons. The database is snapshotted through SQLite's own backup API and
// verified afterwards; files need neither. And an app can perfectly well have
// one and not the other — a BYO `DATABASE_URL` with local uploads, or a
// database with nothing on disk — so one failing must never cancel the other.
//
// Returns nil with no error when there is nothing to archive. An app that has
// never received an upload is not a failed backup.
func (m *Manager) BackupStorage(ctx context.Context, app, env, storageDir string) (*Result, error) {
	info, err := os.Stat(storageDir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", storageDir, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("%s is not a directory", storageDir)
	}

	raw, count, err := tarGz(storageDir, maxStorageBytes)
	if err != nil {
		return nil, err
	}
	if count == 0 {
		return nil, nil
	}

	key := storagePrefix(app, env) + time.Now().UTC().Format(timeLayout) + ".tar.gz"
	if err := m.store.Put(ctx, key, raw); err != nil {
		return nil, fmt.Errorf("upload %s: %w", key, err)
	}
	return &Result{Key: key, StoredBytes: int64(len(raw)), Tables: count}, nil
}

// ListStorage returns the stored storage archives, oldest first.
func (m *Manager) ListStorage(ctx context.Context, app, env string) ([]Entry, error) {
	objects, err := m.store.List(ctx, storagePrefix(app, env))
	if err != nil {
		return nil, err
	}
	out := make([]Entry, 0, len(objects))
	for _, object := range objects {
		stamp, err := timestampOf(object.Key, ".tar.gz")
		if err != nil {
			// An object nobody here wrote. Skipped rather than guessed at: the
			// prefix is shared with whatever else an operator may put in the
			// bucket.
			continue
		}
		out = append(out, Entry{Key: object.Key, Timestamp: stamp, Size: object.Size})
	}
	return out, nil
}

// tarGz walks a directory into a gzipped tar, returning the bytes and how many
// files went in.
//
// Symlinks are recorded as symlinks rather than followed. Following them would
// let a link inside storage/ pull `/etc/shadow` or another app's `.env` into a
// backup that then leaves the machine — the archive equivalent of the zip-slip
// guard on the way in.
//
// `max` is a parameter rather than the constant read directly, so the refusal
// path is exercised by a test that does not have to write a gigabyte.
func tarGz(root string, max int64) ([]byte, int, error) {
	var buffer bytes.Buffer
	zip := gzip.NewWriter(&buffer)
	archive := tar.NewWriter(zip)
	count := 0
	var total int64

	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if relative == "." {
			return nil
		}

		link := ""
		if info.Mode()&os.ModeSymlink != 0 {
			if link, err = os.Readlink(path); err != nil {
				return err
			}
		}
		header, err := tar.FileInfoHeader(info, link)
		if err != nil {
			return err
		}
		// Slash-separated and relative, so the archive is portable and cannot
		// restore itself over an absolute path.
		header.Name = filepath.ToSlash(relative)
		if err := archive.WriteHeader(header); err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return nil
		}

		total += info.Size()
		if total > max {
			return fmt.Errorf(
				"storage/ exceeds %d bytes — refusing to build a backup that would not fit in memory. "+
					"These files are NOT backed up", max)
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()
		if _, err := io.Copy(archive, file); err != nil {
			return err
		}
		count++
		return nil
	})
	if err != nil {
		return nil, 0, err
	}
	if err := archive.Close(); err != nil {
		return nil, 0, err
	}
	if err := zip.Close(); err != nil {
		return nil, 0, err
	}
	return buffer.Bytes(), count, nil
}

// timestampOf reads the time out of a key like `.../20260803T120000Z.tar.gz`.
func timestampOf(key, suffix string) (time.Time, error) {
	base := filepath.Base(key)
	return time.Parse(timeLayout, strings.TrimSuffix(base, suffix))
}
