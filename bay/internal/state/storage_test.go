package state

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// backupOnlyState is a state.json exactly as versions before app blob storage
// wrote it: an `s3` object holding the backup credentials, and no `storage` key.
//
// Written out in full rather than built with a struct, because the struct is
// the thing under test. Splitting the connection fields into an embedded
// S3Target must not move a single byte of this document — Go flattens embedded
// structs in JSON, and this literal is what proves it on the disk of a running
// host rather than in theory.
const backupOnlyState = `{
  "version": 1,
  "baseDomain": "bay.alepha.dev",
  "apps": [
    {
      "name": "lore",
      "env": "production",
      "domains": ["lore.alepha.dev"],
      "port": 4001,
      "runtime": "node",
      "backups": true
    }
  ],
  "s3": {
    "endpoint": "https://acct.r2.cloudflarestorage.com",
    "bucket": "bay-backups",
    "accessKey": "backup-access",
    "secretKey": "backup-secret",
    "region": "auto",
    "keep": 7
  }
}`

func TestBackupConfigSurvivesTheStorageSplit(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	if err := os.WriteFile(path, []byte(backupOnlyState), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := Open(path)
	if err != nil {
		t.Fatalf("a pre-change state file must still load: %v", err)
	}

	t.Run("backup credentials still read", func(t *testing.T) {
		cfg := store.S3()
		if cfg == nil {
			t.Fatal("backup config disappeared")
		}
		if cfg.Endpoint != "https://acct.r2.cloudflarestorage.com" {
			t.Fatalf("endpoint not preserved: %q", cfg.Endpoint)
		}
		if cfg.Bucket != "bay-backups" || cfg.AccessKey != "backup-access" {
			t.Fatalf("credentials not preserved: %+v", cfg)
		}
		if cfg.Keep != 7 {
			t.Fatalf("keep not preserved: %d", cfg.Keep)
		}
	})

	t.Run("no app blob storage is configured", func(t *testing.T) {
		// Absent means absent. An upgrade must not invent a storage backend and
		// silently start routing uploads somewhere new.
		if store.Storage() != nil {
			t.Fatal("upgrading must not configure app storage on its own")
		}
	})

	t.Run("rewriting keeps the s3 object flat", func(t *testing.T) {
		// The embedded struct must stay invisible on the wire. A nested
		// "S3Target" key would be read as "no endpoint configured" by every
		// older binary, i.e. backups would stop with the config still on disk.
		if err := store.Upsert(App{Name: "docs", Env: "production"}); err != nil {
			t.Fatal(err)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(raw), "S3Target") {
			t.Fatalf("embedded struct leaked into the document:\n%s", raw)
		}
		var doc struct {
			S3 map[string]any `json:"s3"`
		}
		if err := json.Unmarshal(raw, &doc); err != nil {
			t.Fatal(err)
		}
		if doc.S3["endpoint"] != "https://acct.r2.cloudflarestorage.com" {
			t.Fatalf("s3.endpoint is no longer a top-level key: %+v", doc.S3)
		}
		if doc.S3["keep"] != float64(7) {
			t.Fatalf("s3.keep is no longer a top-level key: %+v", doc.S3)
		}
	})
}

func TestStorageConfigIsSeparateFromBackups(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}

	// Two credentials, deliberately. The backup key can DELETE backups, and it
	// is handed to nobody; the storage key is written into every app's .env. One
	// key for both would let any hosted app erase the evidence of its own
	// failure.
	if err := store.SetS3(&S3Config{
		S3Target: S3Target{
			Endpoint:  "https://acct.r2.cloudflarestorage.com",
			Bucket:    "bay-backups",
			AccessKey: "backup-access",
			SecretKey: "backup-secret",
		},
		Keep: 3,
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.SetStorage(&S3Target{
		Endpoint:  "https://acct.r2.cloudflarestorage.com",
		Bucket:    "bay-blobs",
		AccessKey: "blob-access",
		SecretKey: "blob-secret",
	}); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}

	backups := reopened.S3()
	blobs := reopened.Storage()
	if backups == nil || blobs == nil {
		t.Fatal("both configs must persist")
	}
	if backups.SecretKey == blobs.SecretKey {
		t.Fatal("the backup secret must never be the one handed to apps")
	}
	if blobs.Bucket != "bay-blobs" {
		t.Fatalf("storage bucket not preserved: %q", blobs.Bucket)
	}
	if backups.Keep != 3 {
		t.Fatalf("keep belongs to backups only, got %d", backups.Keep)
	}
}

func TestStorageIsOmittedWhenUnset(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Upsert(App{Name: "lore", Env: "production"}); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	// An older binary meeting `"storage": null` would be fine, but a human
	// reading the file should not have to decide whether null means "off".
	if strings.Contains(string(raw), "storage") {
		t.Fatalf("unset storage must not be written:\n%s", raw)
	}
}

func TestStorageReturnsACopy(t *testing.T) {
	// Same contract as S3(): a caller that mutates what it got back must not be
	// editing the live registry behind the mutex.
	path := filepath.Join(t.TempDir(), "state.json")
	store, _ := Open(path)
	if err := store.SetStorage(&S3Target{
		Endpoint: "https://acct.r2.cloudflarestorage.com", Bucket: "bay-blobs",
		AccessKey: "a", SecretKey: "b",
	}); err != nil {
		t.Fatal(err)
	}
	got := store.Storage()
	got.Bucket = "hijacked"
	if store.Storage().Bucket != "bay-blobs" {
		t.Fatal("Storage() handed out the live struct")
	}
}
