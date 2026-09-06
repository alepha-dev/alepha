package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/alepha/bay/internal/backup"
	"github.com/alepha/bay/internal/deploy"
	"github.com/alepha/bay/internal/manifest"
	"github.com/alepha/bay/internal/runtimes"
	"github.com/alepha/bay/internal/s3"
	"github.com/alepha/bay/internal/schedule"
	"github.com/alepha/bay/internal/state"
)

const defaultKeep = 14

// backupManager builds a manager from the stored configuration, or nil when
// backups are not configured. Called per request so a `bay config s3:backups` takes
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

// blobsLiveInObjectStorage reports whether this app's uploads are already in a
// bucket, and therefore not something the storage tar should archive again.
func blobsLiveInObjectStorage(app state.App) bool {
	return app.StorageBackend == deploy.BackendS3
}

// notBackedUp lists what a backup of this app deliberately does not cover.
//
// Stated on every response rather than documented once, because the thing that
// makes a backup system fail is somebody believing it covers more than it does
// — and that belief is cheapest to prevent at the moment they run the command.
//
// `storage/` is on this list unconditionally. Bay used to tar it nightly, which
// looked like protection and was not: nothing could restore it, `Prune` never
// walked its prefix so the archives grew without bound, and the whole thing was
// capped by how much fitted in memory. Uploads are shared by putting them in a
// bucket, or they are not shared — and the two cases read very differently, so
// the message distinguishes them.
func notBackedUp(store *state.Store, app state.App) []string {
	out := []string{".env (secrets)"}
	if blobsLiveInObjectStorage(app) {
		where := "the configured bucket"
		if cfg := store.Storage(); cfg != nil {
			where = cfg.Bucket
		}
		// "The blobs are in bucket X" is a different claim from "not covered",
		// and only one of the two is true here.
		return append(out, fmt.Sprintf(
			"storage/ (uploads live in %s — durable, but NOT point-in-time: "+
				"enable bucket versioning, object storage keeps the current blob, "+
				"not yesterday's)", where))
	}
	// One copy, on this disk, and nothing else holds it. Said plainly, with the
	// way out named: an operator cannot learn this from silence.
	return append(out,
		"storage/ (uploads exist ONLY on this host's disk and are not copied anywhere — "+
			"run `bay config s3:apps` then `bay storage migrate` to put them in a bucket)")
}

// appPaths resolves the runtime binary and managed database path for an app.
func (s *server) appPaths(app state.App) (runtime, dbPath string, err error) {
	instance := filepath.Join(s.root, "apps", app.Name, app.Env)
	m, err := manifest.LoadFromRelease(filepath.Join(instance, "current"))
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

/*
backupRefused is a reason not to try, as opposed to an attempt that failed.

The distinction is the whole point of the type. A refusal must NOT touch
`LastBackupError`: an app with no database Bay owns would then sit at "last
backup failed" forever, and only a success could clear it — a warning that is
permanent and wrong, which is how people learn to ignore warnings.
*/
type backupRefused struct{ reason string }

func (e backupRefused) Error() string { return e.reason }

// backupOutcome is what one snapshot produced, for whichever caller asked.
type backupOutcome struct {
	Result      *backup.Result
	Pruned      []backup.Entry
	NotBackedUp []string
}

/*
backupInstance is THE backup path: snapshot, verify, upload, record, prune.

One implementation for the three callers that need it — `bay backup`, the
scheduler, and the console's verb — because it used to be two near-copies that
had already drifted. `runDueBackups` skipped an app whose manifest declared no
database; `handleBackup` did not, so `bay backup` on a BYO-database app ran
`VACUUM INTO` against a file that is not there and recorded a failure only a
success could clear. Gating here fixes the CLI as a side effect.

⚠️ Under a per-instance lock, and the scheduler takes the same one. Two
snapshots of one database at once is the failure this prevents; two snapshots
of DIFFERENT databases are fine and are not serialised here (the scheduler is
sequential for its own reasons — it spawns a runtime per app on a 2-vCPU box).

⚠️ Never under the machine-wide action mutex. A snapshot plus an upload is
minutes, and holding that lock would queue an unrelated restart behind it.
*/
func (s *server) backupInstance(ctx context.Context, app state.App) (backupOutcome, error) {
	// A static site has nothing Bay can snapshot. Trying anyway used to record
	// a failure that only a success can clear, so `bay status` reported the
	// site as broken on every run, forever.
	if app.Static {
		return backupOutcome{}, backupRefused{"a static site has no database to snapshot"}
	}
	// The gate the manual path was missing. `state.App.Backups` is false for an
	// app on a BYO `DATABASE_URL`: there is nothing here Bay could snapshot,
	// and saying so is the honest answer.
	if !app.Backups {
		return backupOutcome{}, backupRefused{
			app.Key() + " declares no database Bay provisioned, so there is nothing to snapshot"}
	}
	mgr, cfg, err := s.backupManager()
	if err != nil || mgr == nil {
		return backupOutcome{}, backupRefused{"backups are not configured: run `bay config s3:backups --endpoint URL --bucket NAME` with BAY_S3_ACCESS_KEY and BAY_S3_SECRET_KEY set"}
	}

	unlock := s.lockBackup(app.Key())
	defer unlock()

	// Recorded on the same terms as the scheduled path, success and failure
	// alike. Before this, a backup taken by hand touched the store not at all:
	// it uploaded, answered 200, and left `LastBackupAt` wherever the scheduler
	// had put it — so `bay status`, which derives staleness from that field,
	// still called the backup stale seconds after one was taken. The command an
	// operator runs deliberately before a risky change was exactly the one whose
	// result `status` could not see.
	runtime, dbPath, err := s.appPaths(app)
	if err != nil {
		s.recordBackupFailure(app.Key(), "resolve paths", err)
		return backupOutcome{}, err
	}
	res, err := mgr.Backup(ctx, app.Name, app.Env, runtime, dbPath)
	if err != nil {
		s.recordBackupFailure(app.Key(), "backup", err)
		return backupOutcome{}, err
	}
	if err := s.store.RecordBackupSuccess(app.Key(), res.Key, time.Now()); err != nil {
		// The bytes are in the bucket; only the bookkeeping failed. Reported as a
		// successful backup, because refusing here would tell an operator their
		// data is not safe when it is.
		s.log.Error("backup succeeded but recording it failed", "app", app.Key(), "err", err)
	}

	// Retention runs here and not on a schedule of its own: pruning is only
	// meaningful right after a new backup exists, and `Prune` returning what it
	// deleted is what keeps retention from being indistinguishable from backups
	// quietly disappearing. A failed prune must not look like a failed backup:
	// the data is safe.
	var pruned []backup.Entry
	if cfg.Keep > 0 {
		pruned, err = mgr.Prune(ctx, app.Name, app.Env, cfg.Keep)
		if err != nil {
			s.log.Error("retention failed after a successful backup", "app", app.Key(), "err", err)
		}
	}

	s.log.Info("backup stored", "app", app.Key(), "key", res.Key,
		"raw", res.RawBytes, "stored", res.StoredBytes, "tables", res.Tables, "pruned", len(pruned))

	return backupOutcome{
		Result: res,
		Pruned: pruned,
		// What is NOT covered has to be stated, every time. The worst failure
		// of a backup system is someone believing they are covered.
		NotBackedUp: notBackedUp(s.store, app),
	}, nil
}

/*
lockBackup serialises snapshots of ONE instance, whoever asked for them.

The scheduler and the manual paths share this, so a backup triggered from a
console at 03:00:01 cannot run `VACUUM INTO` against the same database the
nightly run is already reading.

Per instance rather than machine-wide: two different databases can be
snapshotted at once without hurting each other, and a machine-wide lock here
would be the mutex this whole function exists to stay out of.
*/
func (s *server) lockBackup(key string) func() {
	s.backupMu.Lock()
	if s.backupLocks == nil {
		s.backupLocks = map[string]*sync.Mutex{}
	}
	lock, ok := s.backupLocks[key]
	if !ok {
		lock = &sync.Mutex{}
		s.backupLocks[key] = lock
	}
	s.backupMu.Unlock()

	lock.Lock()
	return lock.Unlock
}

func (s *server) handleBackup(w http.ResponseWriter, r *http.Request) {
	app, ok := s.store.Get(r.PathValue("name") + "/" + r.PathValue("env"))
	if !ok {
		writeError(w, http.StatusNotFound, "unknown app")
		return
	}
	out, err := s.backupInstance(r.Context(), app)
	if err != nil {
		var refused backupRefused
		if errors.As(err, &refused) {
			writeError(w, http.StatusPreconditionFailed, refused.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"key":         out.Result.Key,
		"rawBytes":    out.Result.RawBytes,
		"storedBytes": out.Result.StoredBytes,
		"tables":      out.Result.Tables,
		"integrity":   "ok",
		"pruned":      keys(out.Pruned),
		"notBackedUp": out.NotBackedUp,
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
		writeError(w, http.StatusPreconditionFailed, "backups are not configured: run `bay config s3:backups --endpoint URL --bucket NAME` with BAY_S3_ACCESS_KEY and BAY_S3_SECRET_KEY set")
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
		writeError(w, http.StatusPreconditionFailed, "backups are not configured: run `bay config s3:backups --endpoint URL --bucket NAME` with BAY_S3_ACCESS_KEY and BAY_S3_SECRET_KEY set")
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

	// A restore swaps the database under the app, so it has to stop. Requests
	// wait rather than fail for the length of it.
	defer s.holdDuring(app.Key())()

	if err := s.runner.Stop(app.Key(), stopGrace); err != nil {
		writeError(w, http.StatusInternalServerError, "stop app: "+err.Error())
		return
	}
	if err := backup.Install(restored, dbPath); err != nil {
		// The app was stopped above; a refused install must not also be an
		// outage. When the live database is still in place (setting it aside
		// is the first step, and it is the one that failed) the app comes
		// back on it. Otherwise the database is already set aside and the
		// app stays stopped rather than booting on a half-written file.
		msg := "install: " + err.Error()
		if _, statErr := os.Stat(dbPath); statErr == nil {
			if startErr := s.start(app); startErr != nil {
				msg += "; and the app did not come back: " + startErr.Error()
			} else {
				msg += "; the app is back on its current database"
			}
		} else {
			msg += "; the app is left stopped, its database is set aside next to " + dbPath
		}
		writeError(w, http.StatusInternalServerError, msg)
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
	cfg := state.S3Config{S3Target: state.S3Target{Region: "auto"}, Keep: defaultKeep}
	for i := 0; i < len(args)-1; i++ {
		switch args[i] {
		case "--endpoint":
			cfg.Endpoint = args[i+1]
		case "--bucket":
			cfg.Bucket = args[i+1]
		case "--region":
			cfg.Region = args[i+1]
		case "--keep":
			// Named, like --keep-releases: a typo used to mean "14" silently,
			// and a negative value was stored and failed every retention run.
			keep, err := strconv.Atoi(args[i+1])
			if err != nil || keep < 1 {
				return fmt.Errorf("--keep: %q is not a count of at least 1", args[i+1])
			}
			cfg.Keep = keep
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
	res, err := call(http.MethodPut, controlHost+"/config/s3", bytesReader(body))
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
	res, err := call(http.MethodPost, controlHost+"/apps/"+key+"/backup", nil)
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
	res, err := call(http.MethodGet, controlHost+"/apps/"+key+"/backups", nil)
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
	url := controlHost + "/apps/" + key + "/restore?confirm=yes"
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "--key" {
			url += "&key=" + neturl.QueryEscape(args[i+1])
		}
	}
	res, err := call(http.MethodPost, url, nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

// ---------------------------------------------------------------------------
// scheduled backups
// ---------------------------------------------------------------------------

// backupLoop takes scheduled backups for every app whose database Bay owns.
//
// In-process rather than a systemd timer so the scheduler and the observable
// share one state: `lastBackupAt` is a field of the same `state.json` this
// process already owns and flushes atomically. With a timer, one invocation
// would write the timestamp and another would read it, and "did it stop?" —
// the question that actually protects data — would have two sources of truth.
func (s *server) backupLoop(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		// Loud, because silence here is indistinguishable from a working
		// schedule right up until someone needs a backup.
		s.log.Warn("scheduled backups are OFF (--backup-interval 0); " +
			"nothing is backed up unless you run `bay backup`")
		return
	}
	s.log.Info("scheduled backups on", "interval", interval)

	// The tick is only a prompt to re-examine state, never the schedule itself —
	// that lives in `schedule.Due`, read from the recorded timestamp. So a run
	// missed while Bay was down is taken on the first tick after boot, through
	// the same code path as any other run.
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	s.runDueBackups(ctx, interval)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.runDueBackups(ctx, interval)
		}
	}
}

// runDueBackups backs up every app that is due, one at a time.
//
// Sequential on purpose: each backup spawns the app's own runtime to run
// `VACUUM INTO`, then gzips and uploads. Doing several at once on a 2-vCPU box
// would compete with the apps it is meant to protect. Being sequential also
// makes overlapping runs impossible without a lock.
func (s *server) runDueBackups(ctx context.Context, interval time.Duration) {
	// Asked once per tick only to decide whether there is anything to do at
	// all; `backupInstance` resolves its own manager per run, so a
	// `bay config s3:backups` between two ticks takes effect on the next one.
	//
	// Not configured is silence, not a log line: `bay backup` says so on
	// demand, and repeating it every minute would bury everything else.
	if mgr, _, err := s.backupManager(); err != nil || mgr == nil {
		return
	}
	now := time.Now()
	for _, app := range s.store.Apps() {
		// The same gate `backupInstance` carries, applied early so an app with
		// no database Bay owns costs nothing per tick rather than a refusal
		// per tick.
		if !app.Backups {
			continue
		}
		if !schedule.Due(app.LastBackupAt, now, interval) {
			continue
		}
		s.backupOne(ctx, app)
	}
}

// backupOne runs one scheduled backup through the shared path.
//
// The outcome is already recorded and logged there; a refusal reaching here is
// a state `runDueBackups` filtered for and is worth one debug line, not a
// stored failure.
func (s *server) backupOne(ctx context.Context, app state.App) {
	if _, err := s.backupInstance(ctx, app); err != nil {
		var refused backupRefused
		if errors.As(err, &refused) {
			s.log.Debug("scheduled backup skipped", "app", app.Key(), "reason", refused.Error())
		}
	}
}

// recordBackupFailure logs and persists why an attempt failed.
//
// Persisted as well as logged because a log line scrolls away, and the whole
// point of the record is that someone can ask later.
//
// Shared by the scheduled and the manual path, so the message names neither:
// what failed and at which stage is the same question either way, and a line
// saying "scheduled" about a backup someone just typed would send whoever reads
// it looking for a timer that had nothing to do with it.
func (s *server) recordBackupFailure(key, stage string, cause error) {
	reason := stage + ": " + cause.Error()
	s.log.Error("backup failed", "app", key, "stage", stage, "err", cause)
	if err := s.store.RecordBackupFailure(key, reason, time.Now()); err != nil {
		s.log.Error("could not record the backup failure", "app", key, "err", err)
	}
}
