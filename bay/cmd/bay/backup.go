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
	"strconv"
	"time"

	"github.com/alepha/bay/internal/backup"
	"github.com/alepha/bay/internal/manifest"
	"github.com/alepha/bay/internal/runtimes"
	"github.com/alepha/bay/internal/s3"
	"github.com/alepha/bay/internal/state"
)

const defaultKeep = 14

// backupManager builds a manager from the stored configuration, or nil when
// backups are not configured. Called per request so a `bay config s3` takes
// effect without restarting the proxy.
func (s *server) backupManager() (*backup.Manager, *state.S3Config, error) {
	cfg := s.store.S3()
	if cfg == nil {
		return nil, nil, nil
	}
	client, err := s3.New(s3.Config{
		Endpoint:  cfg.Endpoint,
		Bucket:    cfg.Bucket,
		AccessKey: cfg.AccessKey,
		SecretKey: cfg.SecretKey,
		Region:    cfg.Region,
	})
	if err != nil {
		return nil, cfg, err
	}
	return backup.New(client), cfg, nil
}

// appPaths resolves the runtime binary and managed database path for an app.
func (s *server) appPaths(app state.App) (runtime, dbPath string, err error) {
	instance := filepath.Join(s.root, "apps", app.Name, app.Env)
	m, err := manifest.Load(filepath.Join(instance, "current", "manifest.json"))
	if err != nil {
		return "", "", err
	}
	runtime, err = runtimes.Resolve(s.runtimes, m.Runtime, m.RuntimeVersion)
	if err != nil {
		return "", "", err
	}
	return runtime, filepath.Join(instance, "data", "app.db"), nil
}

// ---------------------------------------------------------------------------
// endpoints
// ---------------------------------------------------------------------------

func (s *server) registerBackupRoutes(mux *http.ServeMux) {
	mux.HandleFunc("PUT /config/s3", s.handleConfigS3)
	mux.HandleFunc("GET /config/s3", func(w http.ResponseWriter, _ *http.Request) {
		cfg := s.store.S3()
		if cfg == nil {
			writeJSON(w, http.StatusOK, map[string]any{"configured": false})
			return
		}
		// The secret is never echoed back. Configuration is write-only for the
		// same reason app secrets are: a compromised session must not be able to
		// read credentials out of the API it can already call.
		writeJSON(w, http.StatusOK, map[string]any{
			"configured": true,
			"endpoint":   cfg.Endpoint,
			"bucket":     cfg.Bucket,
			"region":     cfg.Region,
			"keep":       cfg.Keep,
		})
	})
	mux.HandleFunc("POST /apps/{name}/{env}/backup", s.handleBackup)
	mux.HandleFunc("GET /apps/{name}/{env}/backups", s.handleListBackups)
	mux.HandleFunc("POST /apps/{name}/{env}/restore", s.handleRestore)
}

func (s *server) handleConfigS3(w http.ResponseWriter, r *http.Request) {
	var body state.S3Config
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json: "+err.Error())
		return
	}
	if body.Keep == 0 {
		body.Keep = defaultKeep
	}
	// Validate by constructing the client rather than by checking fields: the
	// operator finds out now, not at the first nightly backup.
	if _, err := s3.New(s3.Config{
		Endpoint: body.Endpoint, Bucket: body.Bucket,
		AccessKey: body.AccessKey, SecretKey: body.SecretKey, Region: body.Region,
	}); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.SetS3(&body); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.log.Info("backup destination configured", "endpoint", body.Endpoint, "bucket", body.Bucket, "keep", body.Keep)
	writeJSON(w, http.StatusOK, map[string]any{"configured": true, "keep": body.Keep})
}

func (s *server) handleBackup(w http.ResponseWriter, r *http.Request) {
	app, ok := s.store.Get(r.PathValue("name") + "/" + r.PathValue("env"))
	if !ok {
		writeError(w, http.StatusNotFound, "unknown app")
		return
	}
	mgr, cfg, err := s.backupManager()
	if err != nil || mgr == nil {
		writeError(w, http.StatusPreconditionFailed, "backups are not configured; PUT /config/s3 first")
		return
	}
	runtime, dbPath, err := s.appPaths(app)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	res, err := mgr.Backup(r.Context(), app.Name, app.Env, runtime, dbPath)
	if err != nil {
		s.log.Error("backup failed", "app", app.Key(), "err", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	pruned, pruneErr := mgr.Prune(r.Context(), app.Name, app.Env, cfg.Keep)
	if pruneErr != nil {
		// A failed prune must not look like a failed backup: the data is safe.
		s.log.Error("retention failed after a successful backup", "app", app.Key(), "err", pruneErr)
	}

	s.log.Info("backup stored", "app", app.Key(), "key", res.Key,
		"raw", res.RawBytes, "stored", res.StoredBytes, "tables", res.Tables, "pruned", len(pruned))
	writeJSON(w, http.StatusOK, map[string]any{
		"key":         res.Key,
		"rawBytes":    res.RawBytes,
		"storedBytes": res.StoredBytes,
		"tables":      res.Tables,
		"integrity":   "ok",
		"pruned":      keys(pruned),
		// What is NOT covered has to be stated, every time. The worst failure of
		// a backup system is someone believing they are covered.
		"notBackedUp": []string{"storage/ (uploaded files)", ".env (secrets)"},
	})
}

func (s *server) handleListBackups(w http.ResponseWriter, r *http.Request) {
	app, ok := s.store.Get(r.PathValue("name") + "/" + r.PathValue("env"))
	if !ok {
		writeError(w, http.StatusNotFound, "unknown app")
		return
	}
	mgr, _, err := s.backupManager()
	if err != nil || mgr == nil {
		writeError(w, http.StatusPreconditionFailed, "backups are not configured")
		return
	}
	entries, err := mgr.List(r.Context(), app.Name, app.Env)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]any, 0, len(entries))
	for _, e := range entries {
		out = append(out, map[string]any{
			"key": e.Key, "at": e.Timestamp.Format(time.RFC3339), "storedBytes": e.Size,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

// handleRestore replaces an app's database with a backup.
//
// Destructive and explicit: it stops the app, sets the current database aside
// rather than deleting it, and only then installs the restored copy.
func (s *server) handleRestore(w http.ResponseWriter, r *http.Request) {
	app, ok := s.store.Get(r.PathValue("name") + "/" + r.PathValue("env"))
	if !ok {
		writeError(w, http.StatusNotFound, "unknown app")
		return
	}
	if r.URL.Query().Get("confirm") != "yes" {
		writeError(w, http.StatusPreconditionRequired, "restoring overwrites the live database; repeat with ?confirm=yes")
		return
	}
	mgr, _, err := s.backupManager()
	if err != nil || mgr == nil {
		writeError(w, http.StatusPreconditionFailed, "backups are not configured")
		return
	}
	runtime, dbPath, err := s.appPaths(app)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	key := r.URL.Query().Get("key")
	if key == "" {
		latest, found, err := mgr.Latest(r.Context(), app.Name, app.Env)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !found {
			writeError(w, http.StatusNotFound, "no backup found for this app")
			return
		}
		key = latest.Key
	}

	// Verified before the app is touched: a corrupt backup must not cost the
	// working database.
	restored, cleanup, err := mgr.Fetch(r.Context(), key, runtime)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer cleanup()

	if err := s.runner.Stop(app.Key(), stopGrace); err != nil {
		writeError(w, http.StatusInternalServerError, "stop app: "+err.Error())
		return
	}
	if err := backup.Install(restored, dbPath); err != nil {
		writeError(w, http.StatusInternalServerError, "install: "+err.Error())
		return
	}
	if err := s.start(app); err != nil {
		writeError(w, http.StatusBadGateway,
			"database restored but the app did not come back: "+err.Error(),
			map[string]any{"restored": key},
		)
		return
	}
	s.log.Info("database restored", "app", app.Key(), "key", key)
	writeJSON(w, http.StatusOK, map[string]any{
		"restored":    key,
		"app":         app.Key(),
		"previousDb":  "kept alongside as app.db.before-restore-*",
		"notRestored": []string{"storage/ (uploaded files)"},
	})
}

// maybeAutoRestore pulls the latest backup when Bay has just created an empty
// database — the disaster-recovery path: fresh VPS, configure the bucket, deploy.
//
// It never runs against an existing database. That single condition is what
// separates "recovery" from "a redeploy silently reverted my data".
func (s *server) maybeAutoRestore(ctx context.Context, app state.App, dbPath string) map[string]any {
	mgr, _, err := s.backupManager()
	if err != nil {
		s.log.Error("backup config unusable, skipping auto-restore", "err", err)
		return map[string]any{"database": "empty (backup destination unusable)"}
	}
	if mgr == nil {
		return map[string]any{"database": "empty (no backup destination configured)"}
	}

	latest, found, err := mgr.Latest(ctx, app.Name, app.Env)
	if err != nil {
		s.log.Error("could not list backups", "app", app.Key(), "err", err)
		return map[string]any{"database": "empty (could not reach the bucket)"}
	}
	if !found {
		s.log.Info("no backup to restore", "app", app.Key())
		return map[string]any{"database": "empty (no backup found)"}
	}

	runtime, _, err := s.appPaths(app)
	if err != nil {
		return map[string]any{"database": "empty (" + err.Error() + ")"}
	}
	restored, cleanup, err := mgr.Fetch(ctx, latest.Key, runtime)
	if err != nil {
		s.log.Error("auto-restore failed", "app", app.Key(), "key", latest.Key, "err", err)
		return map[string]any{"database": "empty (restore failed: " + err.Error() + ")"}
	}
	defer cleanup()

	if err := backup.Install(restored, dbPath); err != nil {
		s.log.Error("auto-restore install failed", "app", app.Key(), "err", err)
		return map[string]any{"database": "empty (install failed: " + err.Error() + ")"}
	}
	s.log.Info("database auto-restored", "app", app.Key(), "key", latest.Key)
	return map[string]any{
		"database":    "restored from " + latest.Key,
		"restoredAt":  latest.Timestamp.Format(time.RFC3339),
		"notRestored": []string{"storage/ (uploaded files)"},
	}
}

func keys(entries []backup.Entry) []string {
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.Key)
	}
	return out
}

// ---------------------------------------------------------------------------
// client commands
// ---------------------------------------------------------------------------

func cmdConfigS3(args []string) error {
	cfg := state.S3Config{Region: "auto", Keep: defaultKeep}
	for i := 0; i < len(args)-1; i++ {
		switch args[i] {
		case "--endpoint":
			cfg.Endpoint = args[i+1]
		case "--bucket":
			cfg.Bucket = args[i+1]
		case "--region":
			cfg.Region = args[i+1]
		case "--keep":
			cfg.Keep, _ = strconv.Atoi(args[i+1])
		}
	}
	// Credentials come from the environment, never argv: an access key on a
	// command line is visible in `ps` to every user on the machine.
	cfg.AccessKey = os.Getenv("BAY_S3_ACCESS_KEY")
	cfg.SecretKey = os.Getenv("BAY_S3_SECRET_KEY")
	if cfg.Endpoint == "" {
		cfg.Endpoint = os.Getenv("BAY_S3_ENDPOINT")
	}
	if cfg.Bucket == "" {
		cfg.Bucket = os.Getenv("BAY_S3_BUCKET")
	}
	if cfg.AccessKey == "" || cfg.SecretKey == "" {
		return errors.New("set BAY_S3_ACCESS_KEY and BAY_S3_SECRET_KEY in the environment")
	}

	body, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	res, err := call(http.MethodPut, "http://"+controlAddr()+"/config/s3", bytesReader(body))
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

func cmdBackup(args []string) error {
	key, err := appKeyArg(args, "bay backup <name/env>")
	if err != nil {
		return err
	}
	res, err := call(http.MethodPost, "http://"+controlAddr()+"/apps/"+key+"/backup", nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

func cmdBackups(args []string) error {
	key, err := appKeyArg(args, "bay backups <name/env>")
	if err != nil {
		return err
	}
	res, err := call(http.MethodGet, "http://"+controlAddr()+"/apps/"+key+"/backups", nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

func cmdRestore(args []string) error {
	key, err := appKeyArg(args, "bay restore <name/env> [--key <backup-key>]")
	if err != nil {
		return err
	}
	url := "http://" + controlAddr() + "/apps/" + key + "/restore?confirm=yes"
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "--key" {
			url += "&key=" + args[i+1]
		}
	}
	res, err := call(http.MethodPost, url, nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}
