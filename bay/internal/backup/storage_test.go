package backup

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// readArchive unpacks what tarGz produced, so assertions are about the archive
// rather than about the writer.
func readArchive(t *testing.T, raw []byte) map[string]*tar.Header {
	t.Helper()
	zip, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("not a gzip stream: %v", err)
	}
	out := map[string]*tar.Header{}
	archive := tar.NewReader(zip)
	for {
		header, err := archive.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("read archive: %v", err)
		}
		copied := *header
		out[header.Name] = &copied
	}
	return out
}

func TestTarGz(t *testing.T) {
	t.Run("archives files with relative slash-separated names", func(t *testing.T) {
		// Portable, and unable to restore itself over an absolute path.
		root := t.TempDir()
		if err := os.MkdirAll(filepath.Join(root, "uploads", "2026"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "uploads", "2026", "a.png"), []byte("png"), 0o644); err != nil {
			t.Fatal(err)
		}

		raw, count, err := tarGz(root, maxStorageBytes)
		if err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatalf("want 1 file counted, got %d", count)
		}
		entries := readArchive(t, raw)
		if _, ok := entries["uploads/2026/a.png"]; !ok {
			t.Fatalf("want a relative slash path, got %v", keysOf(entries))
		}
		for name := range entries {
			if strings.HasPrefix(name, "/") {
				t.Fatalf("absolute path in archive: %q", name)
			}
		}
	})

	t.Run("records a symlink instead of following it", func(t *testing.T) {
		// Following it would let a link inside storage/ pull /etc/shadow or
		// another app's .env into a backup that then leaves the machine.
		outside := filepath.Join(t.TempDir(), "secret.env")
		if err := os.WriteFile(outside, []byte("APP_SECRET=hunter2"), 0o600); err != nil {
			t.Fatal(err)
		}
		root := t.TempDir()
		if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
			t.Skipf("symlinks unavailable: %v", err)
		}

		raw, _, err := tarGz(root, maxStorageBytes)
		if err != nil {
			t.Fatal(err)
		}
		entry, ok := readArchive(t, raw)["link"]
		if !ok {
			t.Fatal("the symlink was dropped entirely")
		}
		if entry.Typeflag != tar.TypeSymlink {
			t.Fatalf("want a symlink header, got type %v", entry.Typeflag)
		}
		if bytes.Contains(mustGunzip(t, raw), []byte("hunter2")) {
			t.Fatal("the linked file's contents were pulled into the archive")
		}
	})

	t.Run("refuses to build an archive it cannot hold", func(t *testing.T) {
		// Enforced rather than discovered: a truncated archive that reads as a
		// complete one is worse than a loud failure.
		root := t.TempDir()
		big := make([]byte, 1<<20)
		for i := 0; i < 3; i++ {
			name := filepath.Join(root, string(rune('a'+i))+".bin")
			if err := os.WriteFile(name, big, 0o644); err != nil {
				t.Fatal(err)
			}
		}
		if _, _, err := tarGz(root, 2<<20); err == nil {
			t.Fatal("want a refusal past the ceiling")
		} else if !strings.Contains(err.Error(), "NOT backed up") {
			t.Fatalf("the error must say the files are not covered, got %v", err)
		}
	})

	t.Run("an empty directory yields no files", func(t *testing.T) {
		_, count, err := tarGz(t.TempDir(), maxStorageBytes)
		if err != nil || count != 0 {
			t.Fatalf("want 0 files and no error, got %d %v", count, err)
		}
	})
}

func TestBackupStorageNothingToDo(t *testing.T) {
	// Neither of these touches the object store, so a Manager without one is
	// enough — and proves the early returns happen before any upload.
	manager := New(nil)

	t.Run("an absent directory is not a failure", func(t *testing.T) {
		// An app that has never received an upload is not a failed backup.
		res, err := manager.BackupStorage(context.Background(), "lore", "production",
			filepath.Join(t.TempDir(), "storage"))
		if res != nil || err != nil {
			t.Fatalf("want nil, nil — got %v %v", res, err)
		}
	})

	t.Run("an empty directory is not a failure", func(t *testing.T) {
		res, err := manager.BackupStorage(context.Background(), "lore", "production", t.TempDir())
		if res != nil || err != nil {
			t.Fatalf("want nil, nil — got %v %v", res, err)
		}
	})

	t.Run("a file where a directory belongs is a failure", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "storage")
		if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		if _, err := manager.BackupStorage(context.Background(), "lore", "production", path); err == nil {
			t.Fatal("want an error rather than a silent skip")
		}
	})
}

func TestStorageKeysAreSeparateFromDatabaseKeys(t *testing.T) {
	// Listing, pruning and restoring must never mix the two. Prune walks a
	// prefix and deletes what it finds past the keep window: if storage keys
	// sorted under the database prefix, retention on one would silently delete
	// the other.
	db := dbPrefix("lore", "production")
	storage := storagePrefix("lore", "production")
	if strings.HasPrefix(storage, db) || strings.HasPrefix(db, storage) {
		t.Fatalf("one prefix contains the other: %q vs %q", db, storage)
	}
}

func TestTimestampOf(t *testing.T) {
	got, err := timestampOf("apps/lore/production/storage/20260803T120000Z.tar.gz", ".tar.gz")
	if err != nil {
		t.Fatal(err)
	}
	if !got.Equal(time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("want 2026-08-03T12:00:00Z, got %v", got)
	}

	if _, err := timestampOf("apps/lore/production/storage/notes.txt", ".tar.gz"); err == nil {
		// Skipped rather than guessed at: the bucket is shared with whatever
		// else an operator puts in it.
		t.Fatal("want an error for a key nobody here wrote")
	}
}

func mustGunzip(t *testing.T, raw []byte) []byte {
	t.Helper()
	zip, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	out, err := io.ReadAll(zip)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func keysOf(m map[string]*tar.Header) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
