package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/alepha/bay/internal/deploy"
	"github.com/alepha/bay/internal/s3"
	"github.com/alepha/bay/internal/state"
)

// Where hosted apps put their blobs.
//
// Separate from the backup destination on purpose. Every app that declares a
// bucket receives THESE credentials in its own `.env`; the backup credentials
// are never handed out, because an app holding them could delete its own
// backups. Pointing both at the same bucket is fine — `apps/<name>/<env>/db/`,
// `.../storage/` and `.../blobs/` do not collide — but they must be two
// different tokens.

// storageProbeTimeout bounds the reachability check below.
//
// Short: this runs in front of an operator waiting on a prompt, and the answer
// to "is this endpoint reachable" does not get truer with more seconds.
const storageProbeTimeout = 15 * time.Second

func (s *server) registerStorageRoutes(mux *http.ServeMux) {
	mux.HandleFunc("PUT /config/storage", s.handleConfigStorage)
	mux.HandleFunc("GET /config/storage", s.handleGetConfigStorage)
	mux.HandleFunc("POST /apps/{name}/{env}/storage/migrate", s.handleMigrateStorage)
}

func (s *server) handleConfigStorage(w http.ResponseWriter, r *http.Request) {
	var body state.S3Target
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json: "+err.Error())
		return
	}
	if body.Region == "" {
		// What R2 wants, and what nobody remembers to pass.
		body.Region = "auto"
	}

	client, err := s3.New(s3.Config{
		Endpoint: body.Endpoint, Bucket: body.Bucket,
		AccessKey: body.AccessKey, SecretKey: body.SecretKey, Region: body.Region,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Reach the bucket before storing anything.
	//
	// `bay config s3` stops at constructing the client, and for backups that is
	// defensible: a bad credential shows up in the log of a nightly job. These
	// credentials are different — they go into every app's environment, so the
	// first thing a wrong key breaks is a user's upload, in production, with
	// nothing in Bay's log at all. One listing settles it here instead.
	ctx, cancel := context.WithTimeout(r.Context(), storageProbeTimeout)
	defer cancel()
	if _, err := client.List(ctx, "bay-probe/"); err != nil {
		writeError(w, http.StatusBadRequest, "cannot reach the bucket with these credentials: "+err.Error())
		return
	}

	if err := s.store.SetStorage(&body); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.log.Info("app storage configured", "endpoint", body.Endpoint, "bucket", body.Bucket)
	writeJSON(w, http.StatusOK, map[string]any{"configured": true, "bucket": body.Bucket})
}

func (s *server) handleGetConfigStorage(w http.ResponseWriter, _ *http.Request) {
	cfg := s.store.Storage()
	if cfg == nil {
		writeJSON(w, http.StatusOK, map[string]any{"configured": false})
		return
	}
	// The secret is never echoed back, for the same reason the backup one is
	// not: a compromised session must not be able to read credentials out of an
	// API it can already call.
	writeJSON(w, http.StatusOK, map[string]any{
		"configured": true,
		"endpoint":   cfg.Endpoint,
		"bucket":     cfg.Bucket,
		"region":     cfg.Region,
		// Surfaced so `bay status` can keep saying it. A credential shared with
		// the backup half is a decision that stays true long after the command
		// that made it scrolled out of the terminal.
		"sharedCredential": s.store.CredentialsShared(),
	})
}

// maxMigratedFileBytes bounds one blob during a migration.
//
// The S3 client takes a byte slice, so every file is held whole in memory —
// the same honest limit `BackupStorage` documents. Enforced rather than
// discovered: an operator must be told which file was too big, not have the
// supervisor OOM and take every other app on the host down with it.
const maxMigratedFileBytes int64 = 512 << 20

func (s *server) handleMigrateStorage(w http.ResponseWriter, r *http.Request) {
	app, ok := s.store.Get(r.PathValue("name") + "/" + r.PathValue("env"))
	if !ok {
		writeError(w, http.StatusNotFound, "unknown app")
		return
	}
	cfg := s.store.Storage()
	if cfg == nil {
		writeError(w, http.StatusPreconditionFailed,
			"no blob storage is configured: run `bay config s3:apps --endpoint URL --bucket NAME` "+
				"with BAY_STORAGE_ACCESS_KEY and BAY_STORAGE_SECRET_KEY set")
		return
	}
	client, err := s3.New(s3.Config{
		Endpoint: cfg.Endpoint, Bucket: cfg.Bucket,
		AccessKey: cfg.AccessKey, SecretKey: cfg.SecretKey, Region: cfg.Region,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	instance := filepath.Join(s.root, "apps", app.Name, app.Env)
	storageDir := filepath.Join(instance, "storage")

	// Stopped for the length of the copy. An app still accepting uploads while
	// its directory is walked writes files the walk has already passed, and
	// those are exactly the ones nobody notices are missing.
	wasRunning := s.runner.Running(app.Key())
	if wasRunning {
		_ = s.runner.Stop(app.Key(), stopGrace)
	}

	copied, err := uploadTree(r.Context(), client, storageDir, deploy.BlobPrefix(app.Name, app.Env))
	if err != nil {
		// Put the app back the way it was. A failed migration must not also be
		// an outage.
		if wasRunning {
			if startErr := s.start(app); startErr != nil {
				s.log.Error("app did not restart after a failed migration",
					"app", app.Key(), "err", startErr)
			}
		}
		writeError(w, http.StatusInternalServerError, "copy failed: "+err.Error())
		return
	}

	repoint := s.repoint
	if repoint == nil {
		repoint = deploy.RepointStorage
	}
	if err := repoint(instance, app.Name, app.Env, cfg); err != nil {
		// The files are copied but `.env` is unchanged, so the app comes back
		// on local storage: a failed migration must not also be an outage.
		if wasRunning {
			if startErr := s.start(app); startErr != nil {
				s.log.Error("app did not restart after a failed migration",
					"app", app.Key(), "err", startErr)
			}
		}
		writeError(w, http.StatusInternalServerError, "rewriting .env failed: "+err.Error())
		return
	}
	// Before starting, not after: the sandbox reads this to decide whether the
	// app still gets a writable `storage/`.
	if err := s.store.SetStorageBackend(app.Key(), deploy.BackendS3); err != nil {
		if wasRunning {
			if startErr := s.start(app); startErr != nil {
				s.log.Error("app did not restart after a failed migration",
					"app", app.Key(), "err", startErr)
			}
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	if wasRunning {
		app, _ = s.store.Get(app.Key())
		if err := s.start(app); err != nil {
			writeError(w, http.StatusInternalServerError,
				"files are copied and the app is repointed, but it did not restart: "+err.Error())
			return
		}
	}

	s.log.Info("storage migrated", "app", app.Key(), "files", copied, "bucket", cfg.Bucket)
	writeJSON(w, http.StatusOK, map[string]any{
		"copied": copied,
		"bucket": cfg.Bucket,
		"prefix": deploy.BlobPrefix(app.Name, app.Env),
		// The local files are still there, deliberately. Deleting the only
		// other copy in the same command that wrote the new one is one bug away
		// from losing the data.
		"localFilesKept": storageDir,
	})
}

// uploadTree copies every regular file under dir to <prefix>/<relative path>.
//
// The relative path IS the key. The local provider writes
// `<root>/<tenantId?>/<container>/<fileId>` and the S3 provider keys
// `<prefix>/<tenantId?>/<container>/<fileId>` — the same shape — so preserving
// the path is the whole mapping, and inventing one would put the files
// somewhere the app never looks.
func uploadTree(ctx context.Context, client *s3.Client, dir, prefix string) (int, error) {
	copied := 0
	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		// Symlinks are not followed: one placed in `storage/` could otherwise
		// push `/etc/shadow` or another app's `.env` into a bucket. Same rule
		// the storage backup already follows.
		if d.Type()&os.ModeSymlink != 0 {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if info.Size() > maxMigratedFileBytes {
			return fmt.Errorf("%s is %d bytes, over the %d-byte limit this migration can hold in memory",
				path, info.Size(), maxMigratedFileBytes)
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		key := prefix + "/" + filepath.ToSlash(rel)
		if err := client.Put(ctx, key, body); err != nil {
			return fmt.Errorf("upload %s: %w", key, err)
		}
		copied++
		return nil
	})
	if os.IsNotExist(err) {
		// An app that never took an upload has nothing to migrate, which is a
		// success, not a failure.
		return 0, nil
	}
	return copied, err
}

// ---------------------------------------------------------------------------
// client command
// ---------------------------------------------------------------------------

func cmdStorageMigrate(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: bay storage migrate <name/env>")
	}
	instance := args[0]
	if !strings.Contains(instance, "/") {
		return fmt.Errorf("expected <name/env>, got %q", instance)
	}
	res, err := call(http.MethodPost,
		controlHost+"/apps/"+instance+"/storage/migrate", nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	fmt.Println("\nThe local files were KEPT. Check the app serves them from the bucket,\n" +
		"then delete the directory yourself — this command will not remove the\n" +
		"only other copy of your data.")
	return nil
}

// cmdConfigS3Both points BOTH halves at one bucket with one credential.
//
// The convenient path, and the less safe one: an app receives this key in its
// `.env`, and this key also reaches the backups — so any hosted app can delete
// every backup on the host, which is precisely what the two-credential split
// exists to prevent.
//
// Allowed anyway. A one-operator fleet should not have to mint two tokens
// before it can store its first file, and refusing would only teach people to
// paste the same credential into both subcommands — the same outcome, with the
// warning skipped. So it is offered, said out loud here, and reported by
// `bay status` for as long as it is true.
func cmdConfigS3Both(args []string) error {
	fmt.Fprintln(os.Stderr,
		"⚠ one credential for BOTH app storage and backups.\n"+
			"  Every hosted app is given this key, and this key can delete every backup\n"+
			"  on this host. For two separate tokens:\n"+
			"      bay config s3:backups --endpoint URL --bucket NAME   # BAY_S3_*\n"+
			"      bay config s3:apps    --endpoint URL --bucket NAME   # BAY_STORAGE_*")

	if err := cmdConfigS3(args); err != nil {
		return err
	}
	// Same values, second half. The env vars the operator already set for the
	// backup half are reused rather than demanded twice — asking for
	// BAY_STORAGE_* here would make the shortcut longer than doing it properly.
	os.Setenv("BAY_STORAGE_ACCESS_KEY", os.Getenv("BAY_S3_ACCESS_KEY"))
	os.Setenv("BAY_STORAGE_SECRET_KEY", os.Getenv("BAY_S3_SECRET_KEY"))
	return cmdConfigStorage(args)
}

func cmdConfigStorage(args []string) error {
	cfg := state.S3Target{Region: "auto"}
	for i := 0; i < len(args)-1; i++ {
		switch args[i] {
		case "--endpoint":
			cfg.Endpoint = args[i+1]
		case "--bucket":
			cfg.Bucket = args[i+1]
		case "--region":
			cfg.Region = args[i+1]
		}
	}
	// Credentials come from the environment, never argv: an access key on a
	// command line is visible in `ps` to every user on the machine.
	cfg.AccessKey = os.Getenv("BAY_STORAGE_ACCESS_KEY")
	cfg.SecretKey = os.Getenv("BAY_STORAGE_SECRET_KEY")
	if cfg.Endpoint == "" {
		cfg.Endpoint = os.Getenv("BAY_STORAGE_ENDPOINT")
	}
	if cfg.Bucket == "" {
		cfg.Bucket = os.Getenv("BAY_STORAGE_BUCKET")
	}
	if cfg.AccessKey == "" || cfg.SecretKey == "" {
		return errors.New("set BAY_STORAGE_ACCESS_KEY and BAY_STORAGE_SECRET_KEY in the environment")
	}

	body, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	res, err := call(http.MethodPut, controlHost+"/config/storage", bytesReader(body))
	if err != nil {
		return err
	}
	fmt.Println(res)
	// Durable is not the same as recoverable. The tar backup of `storage/` goes
	// away for every app that moves here, and object storage does not undo a
	// delete on its own.
	fmt.Println("\nEnable versioning on this bucket: object storage keeps the current\n" +
		"version of a blob, not yesterday's. Without it, code that deletes the\n" +
		"wrong key has deleted it everywhere.")
	return nil
}

// sharedCredentialConfigured asks the control API whether the two halves are
// one credential.
//
// Best-effort: a status report must not fail because a warning could not be
// fetched. Silence here means "could not tell", which is the same shape as the
// answer being false and does not deserve an error the operator has to read
// past to see their fleet.
func sharedCredentialConfigured() bool {
	raw, err := call(http.MethodGet, controlHost+"/config/storage", nil)
	if err != nil {
		return false
	}
	var cfg struct {
		SharedCredential bool `json:"sharedCredential"`
	}
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return false
	}
	return cfg.SharedCredential
}
