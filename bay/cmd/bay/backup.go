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
	"sync"
	"time"

	"github.com/alepha-dev/bay/internal/backup"
	"github.com/alepha-dev/bay/internal/deploy"
	"github.com/alepha-dev/bay/internal/manifest"
	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/runner"
	"github.com/alepha-dev/bay/internal/s3"
	"github.com/alepha-dev/bay/internal/state"
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

/*
appPaths resolves the runtime the backup helper runs with, and the app's
data/ folder: every SQLite database in it is backed up, and nothing outside it.

The helper runs in the app's own runtime image, so the SQLite that reads the
database is the one that wrote it.
*/
func (s *server) appPaths(app state.App) (runtime backup.Interpreter, dataDir string, err error) {
	if app.Image != "" {
		return nil, "", fmt.Errorf("%s is an image app: Bay provisions no database for it, so there is nothing to back up", app.Key())
	}
	tasks, ok := s.runner.(taskRunner)
	if !ok {
		return nil, "", fmt.Errorf("%s: backups run in the app's runtime image, and this runner cannot run one", app.Key())
	}
	instance := filepath.Join(s.root, "apps", naming.Instance(app.Name, app.Env))
	m, err := manifest.LoadFromRelease(filepath.Join(instance, "current"))
	if err != nil {
		return nil, "", err
	}
	sel, err := s.runtimeSelection(app)
	if err != nil {
		return nil, "", err
	}
	return &imageInterpreter{tasks: tasks, image: sel.Ref, command: m.Runtime,
		scratch: filepath.Join(s.root, "tmp")}, filepath.Join(instance, "data"), nil
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
	mux.HandleFunc("POST /apps/{name}/{env}/restore/dismiss", s.handleRestoreDismiss)
	mux.HandleFunc("POST /apps/{name}/{env}/backup/verify", s.handleVerifyBackup)
	mux.HandleFunc("POST /backups/verify", s.handleVerifyAll)
	s.registerBackupPolicyRoutes(mux)
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
backup failed" forever, and only a success could clear it - a warning that is
permanent and wrong, which is how people learn to ignore warnings.
*/
type backupRefused struct{ reason string }

func (e backupRefused) Error() string { return e.reason }

// backupOutcome is what one snapshot produced, for whichever caller asked.
type backupOutcome struct {
	Result      *backup.Result
	Pruned      []backup.Entry
	NotBackedUp []string
	// PruneSuspended says why retention was skipped, empty when it ran.
	PruneSuspended string
}

/*
backupInstance is THE backup path: snapshot, verify, upload, record, prune.

One implementation for the three callers that need it - `bay backup`, the
scheduler, and the console's verb - because it used to be two near-copies that
had already drifted. `runDueBackups` skipped an app whose manifest declared no
database; `handleBackup` did not, so `bay backup` on a BYO-database app ran
`VACUUM INTO` against a file that is not there and recorded a failure only a
success could clear. Gating here fixes the CLI as a side effect.

⚠️ Under a per-instance lock, and the scheduler takes the same one. Two
snapshots of one database at once is the failure this prevents; two snapshots
of DIFFERENT databases are fine and are not serialised here (the scheduler is
sequential for its own reasons - it spawns a runtime per app on a 2-vCPU box).

⚠️ Never under the machine-wide action mutex. A snapshot plus an upload is
minutes, and holding that lock would queue an unrelated restart behind it.
*/
func (s *server) backupInstance(ctx context.Context, app state.App) (backupOutcome, error) {
	return s.backupInstanceAs(ctx, app, "manual", "")
}

// backupInstanceAs is backupInstance saying what asked for it, which the
// bundle's manifest records ("manual", "schedule", "console", "deploy"), and
// with the tag its directory carries (backup.TagPreDeploy, an operator's
// label, or none).
func (s *server) backupInstanceAs(ctx context.Context, app state.App, trigger, tag string) (backupOutcome, error) {
	if err := backup.ValidTag(tag); err != nil {
		return backupOutcome{}, backupRefused{err.Error()}
	}
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
	mgr, _, err := s.backupManager()
	if err != nil || mgr == nil {
		return backupOutcome{}, backupRefused{"backups are not configured: run `bay config s3:backups --endpoint URL --bucket NAME` with BAY_S3_ACCESS_KEY and BAY_S3_SECRET_KEY set"}
	}

	unlock := s.lockBackup(app.Key())
	defer unlock()
	started := time.Now()
	var manifest *backup.Manifest

	// Recorded on the same terms as the scheduled path, success and failure
	// alike. Before this, a backup taken by hand touched the store not at all:
	// it uploaded, answered 200, and left `LastBackupAt` wherever the scheduler
	// had put it — so `bay status`, which derives staleness from that field,
	// still called the backup stale seconds after one was taken. The command an
	// operator runs deliberately before a risky change was exactly the one whose
	// result `status` could not see.
	var res *backup.Result
	notCovered := notBackedUp(s.store, app)
	if app.BackupHook != nil {
		// A stack service: its own hook, in its own container. A stopped
		// stack has no container to run it in, and that is a refusal: the
		// operator stopped it, the backup did not fail.
		if tag != "" {
			return backupOutcome{}, backupRefused{"a service dump is one object and takes no tag; tags apply to database bundles"}
		}
		if se, ok := s.store.StackEnv(app.Stack, app.Env); ok && se.Stopped {
			return backupOutcome{}, backupRefused{app.Stack + "/" + app.Env + " is stopped: start it to back up " + app.Service}
		}
		res, err = mgr.BackupDump(ctx, app.Name, app.Env, serviceDumper{container: runner.ContainerName(app.Key()), hook: *app.BackupHook})
		if err != nil {
			s.recordBackupFailure(ctx, app, "backup", err)
			return backupOutcome{}, err
		}
		notCovered = serviceNotBackedUp(app)
	} else {
		runtime, dataDir, err := s.appPaths(app)
		if err != nil {
			s.recordBackupFailure(ctx, app, "resolve paths", err)
			return backupOutcome{}, err
		}
		res, manifest, err = mgr.BackupBundle(ctx, app.Name, app.Env, runtime, dataDir,
			backup.BundleMeta{Release: app.Release, Trigger: trigger, Tag: tag, Bay: version})
		if err != nil {
			s.recordBackupFailure(ctx, app, "backup", err)
			return backupOutcome{}, err
		}
	}
	finished := time.Now()
	rec := backupRecord(res, manifest, trigger, tag, app.Release, finished.Sub(started), finished)
	var previous *state.BackupRecord
	if current, ok := s.store.Get(app.Key()); ok {
		previous = current.LastBackup
	}
	rec.Anomalies = backupAnomalies(previous, rec)
	if err := s.store.RecordBackup(app.Key(), rec); err != nil {
		// The bytes are in the bucket; only the bookkeeping failed. Reported as a
		// successful backup, because refusing here would tell an operator their
		// data is not safe when it is.
		s.log.Error("backup succeeded but recording it failed", "app", app.Key(), "err", err)
	}
	// A backup that succeeds proves the bucket answers.
	if s.targets != nil {
		s.targets.set(s, "ok", "", "")
	}

	// Retention runs here and not on a schedule of its own: pruning is only
	// meaningful right after a new backup exists, and `Prune` returning what it
	// deleted is what keeps retention from being indistinguishable from backups
	// quietly disappearing. A failed prune must not look like a failed backup:
	// the data is safe.
	//
	// The rules are the app's effective policy, not the bucket's: two apps on
	// one bucket may keep different histories. No rule at all, or a bucket
	// whose lifecycle rules expire backups, and Bay deletes nothing.
	var pruned []backup.Entry
	suspended := ""
	policy := s.effectiveBackupPolicy(app)
	prunes := !policy.KeepsEverything()
	if prunes {
		suspended = s.pruneSuspended(ctx, mgr, app.Key(), app.Name, app.Env)
	}
	if prunes && suspended == "" {
		pruned, err = mgr.Prune(ctx, app.Name, app.Env, retentionRules(policy))
		if err != nil {
			s.log.Error("retention failed after a successful backup", "app", app.Key(), "err", err)
		}
	}

	s.log.Info("backup stored", "app", app.Key(), "key", res.Key,
		"raw", res.RawBytes, "stored", res.StoredBytes, "tables", res.Tables, "pruned", len(pruned))
	s.refreshCatalog(ctx, mgr, app)

	s.emit("backup.completed", &app, map[string]any{
		"key": rec.Key, "kind": rec.Kind, "trigger": trigger, "tag": tag, "release": rec.Release,
		"rawBytes": rec.RawBytes, "storedBytes": rec.StoredBytes, "durationMs": rec.DurationMs, "files": rec.Files,
	})
	if len(pruned) > 0 {
		keys := make([]string, 0, len(pruned))
		for i, p := range pruned {
			if i == 50 {
				break
			}
			keys = append(keys, p.Key)
		}
		s.emit("backup.pruned", &app, map[string]any{"count": len(pruned), "keys": keys})
	}
	if len(rec.Anomalies) > 0 {
		s.log.Warn("backup looks unlike the previous one", "app", app.Key(), "anomalies", joinAnomalies(rec.Anomalies))
		s.emit("backup.anomaly", &app, map[string]any{"key": rec.Key, "anomalies": rec.Anomalies})
	}

	return backupOutcome{
		Result:         res,
		Pruned:         pruned,
		PruneSuspended: suspended,
		// What is NOT covered has to be stated, every time. The worst failure
		// of a backup system is someone believing they are covered.
		NotBackedUp: append(notCovered, notBackedUpVolumes(s.uncoveredVolumes(app.Stack, app.Env))...),
	}, nil
}

/*
pruneSuspended is the retention guard for an instance marked RestorePending:
non-empty (the reason) when pruning must be skipped this time.

Read from the store rather than the `app` the caller holds, which may be a
copy taken before the deploy marked it.

The guard lifts itself once there is nothing left to protect: no backup older
than the moment the empty database appeared. Listing failed is "keep
everything" - deleting backups on a guess is the one thing this must not do.
*/
func (s *server) pruneSuspended(ctx context.Context, mgr *backup.Manager, key, name, env string) string {
	current, ok := s.store.Get(key)
	if !ok || current.RestorePending == nil {
		return ""
	}
	pending := *current.RestorePending
	entries, err := mgr.List(ctx, name, env)
	if err != nil {
		s.log.Warn("pruning skipped: restore pending and backups could not be listed", "app", key, "err", err)
		return "restore pending since " + pending.Since + " (" + pending.Reason + "); backups could not be listed"
	}
	since := pending.SinceTime()
	older := 0
	for _, e := range entries {
		if since.IsZero() || e.Timestamp.Before(since) {
			older++
		}
	}
	if older == 0 {
		s.log.Info("restore pending lifted: no backup predates the empty database", "app", key)
		s.clearRestorePending(key)
		return ""
	}
	s.log.Warn("pruning skipped: backups older than the empty database are kept until `bay restore` or `bay restore --dismiss`",
		"app", key, "since", pending.Since, "reason", pending.Reason, "older", older)
	return fmt.Sprintf("restore pending since %s (%s); %d older backup(s) kept: run `bay restore %s` or `bay restore %s --dismiss`",
		pending.Since, pending.Reason, older, key, key)
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
	out, err := s.backupInstanceAs(r.Context(), app, "manual", r.URL.Query().Get("tag"))
	if err != nil {
		var refused backupRefused
		if errors.As(err, &refused) {
			writeError(w, http.StatusPreconditionFailed, refused.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	resp := map[string]any{
		"key":         out.Result.Key,
		"rawBytes":    out.Result.RawBytes,
		"storedBytes": out.Result.StoredBytes,
		"tables":      out.Result.Tables,
		"kind":        out.Result.Kind,
		"files":       out.Result.Files,
		"integrity":   "ok",
		"pruned":      keys(out.Pruned),
		"notBackedUp": out.NotBackedUp,
	}
	if out.PruneSuspended != "" {
		resp["pruneSuspended"] = out.PruneSuspended
	}
	writeJSON(w, http.StatusOK, resp)
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
	describe := func(e backup.Entry) map[string]any {
		m := map[string]any{
			"key": e.Key, "at": e.Timestamp.Format(time.RFC3339), "storedBytes": e.Size,
			"kind": e.Kind, "files": e.Files,
		}
		if e.Tag != "" {
			m["tag"] = e.Tag
		}
		return m
	}
	if r.URL.Query().Get("plan") != "" {
		s.writeRetentionPlan(w, r, mgr, app, describe)
		return
	}
	entries, err := mgr.List(r.Context(), app.Name, app.Env)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]any, 0, len(entries))
	for _, e := range entries {
		out = append(out, describe(e))
	}
	writeJSON(w, http.StatusOK, out)
}

/*
writeRetentionPlan answers `bay backups --plan`: what the next prune would
keep and delete, and why, deleting nothing. A retention change is checked
here before it costs a backup.
*/
func (s *server) writeRetentionPlan(w http.ResponseWriter, r *http.Request, mgr *backup.Manager, app state.App, describe func(backup.Entry) map[string]any) {
	policy := s.effectiveBackupPolicy(app)
	resp := map[string]any{"policy": policyLine(policy)}
	if policy.KeepsEverything() {
		resp["prunes"] = false
		entries, err := mgr.List(r.Context(), app.Name, app.Env)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		resp["keep"], resp["delete"] = len(entries), 0
		writeJSON(w, http.StatusOK, resp)
		return
	}
	plan, err := mgr.Plan(r.Context(), app.Name, app.Env, retentionRules(policy), time.Now())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	backups := make([]map[string]any, 0, len(plan))
	kept, deleted := 0, 0
	for _, d := range plan {
		m := describe(d.Entry)
		m["keep"], m["reasons"] = d.Keep, d.Reasons
		if d.Incomplete {
			m["incomplete"] = true
		}
		if d.Keep {
			kept++
		} else {
			deleted++
		}
		backups = append(backups, m)
	}
	resp["prunes"], resp["keep"], resp["delete"], resp["backups"] = true, kept, deleted, backups
	if reason := s.pruneSuspended(r.Context(), mgr, app.Key(), app.Name, app.Env); reason != "" {
		resp["pruneSuspended"] = reason
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleRestore replaces an app's database with a backup.
//
// Destructive and explicit: it stops the app, sets the current database aside
// rather than deleting it, and only then installs the restored copy.
func fetchedPaths(f *backup.Fetched) []string {
	out := make([]string, 0, len(f.Files))
	for _, file := range f.Files {
		out = append(out, file.Path)
	}
	return out
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
		return s.startedEmptyUnchecked(app, "backup destination unusable")
	}
	if mgr == nil {
		// Pending too: the usual disaster recovery configures the bucket AFTER
		// the first deploy, and that bucket may hold the previous machine's
		// backups.
		return s.startedEmptyUnchecked(app, "no backup destination configured")
	}

	latest, found, err := mgr.Latest(ctx, app.Name, app.Env)
	if err != nil {
		s.log.Error("could not list backups", "app", app.Key(), "err", err)
		return s.startedEmptyUnchecked(app, "could not reach the bucket")
	}
	if !found {
		s.log.Info("no backup to restore", "app", app.Key())
		// Checked and nothing there: a genuinely new app, nothing to protect.
		s.clearRestorePending(app.Key())
		return map[string]any{"database": "empty (no backup found)"}
	}

	runtime, _, err := s.appPaths(app)
	if err != nil {
		return s.startedEmptyUnchecked(app, err.Error())
	}
	key, kind, err := backup.RestoreKey(app.Name, app.Env, latest.Key)
	if err != nil {
		return s.startedEmptyUnchecked(app, err.Error())
	}
	fetched, cleanup, err := mgr.FetchAny(ctx, key, kind, runtime)
	if err != nil {
		s.log.Error("auto-restore failed", "app", app.Key(), "key", latest.Key, "err", err)
		return s.startedEmptyUnchecked(app, "restore failed: "+err.Error())
	}
	defer cleanup()

	// Into the folder of the database Bay just created: a bundle holds every
	// database the app had there.
	if _, err := backup.InstallBundle(fetched, filepath.Dir(dbPath)); err != nil {
		s.log.Error("auto-restore install failed", "app", app.Key(), "err", err)
		return s.startedEmptyUnchecked(app, "install failed: "+err.Error())
	}
	s.clearRestorePending(app.Key())
	s.log.Info("database auto-restored", "app", app.Key(), "key", latest.Key)
	s.recordRestore(app, state.RestoreRecord{Key: latest.Key, Trigger: "deploy", Status: "done",
		Reason: "empty database on deploy, latest backup restored"})
	return map[string]any{
		"database":    "restored from " + latest.Key,
		"restoredAt":  latest.Timestamp.Format(time.RFC3339),
		"files":       fetchedPaths(fetched),
		"notRestored": []string{"storage/ (uploaded files)"},
	}
}

/*
startedEmptyUnchecked is the deploy going ahead on an empty database when Bay
could not find out whether a backup should have been restored into it.

The deploy is not refused: an app that cannot start because a bucket is down
is an outage of its own. But the instance is marked `RestorePending`, and that
is what stops retention from deleting the real backups once the empty
database starts being backed up in their place.
*/
func (s *server) startedEmptyUnchecked(app state.App, reason string) map[string]any {
	s.log.Warn("app started on an EMPTY database, its backups were not checked; "+
		"pruning is paused for it until `bay restore` or `bay restore --dismiss`",
		"app", app.Key(), "reason", reason)
	if err := s.store.SetRestorePending(app.Key(), reason, time.Now()); err != nil {
		s.log.Error("could not record the pending restore", "app", app.Key(), "err", err)
	}
	s.emit("restore.pending", &app, map[string]any{"reason": clip(reason)})
	return map[string]any{
		"database":       "empty (" + reason + ")",
		"restorePending": true,
		"next":           "old backups are kept (pruning paused); run `bay restore " + app.Key() + "` to recover them, or `bay restore " + app.Key() + " --dismiss` to keep the new database",
	}
}

func (s *server) clearRestorePending(key string) {
	if err := s.store.ClearRestorePending(key); err != nil {
		s.log.Error("could not clear the pending restore", "app", key, "err", err)
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
	key, err := appKeyArg(args, "bay backup <name/env> [--tag NAME]")
	if err != nil {
		return err
	}
	if err := checkFlags(args[1:], nil, map[string]bool{"--tag": true}); err != nil {
		return err
	}
	path := controlHost + "/apps/" + key + "/backup"
	if tag := flagValue(args, "--tag"); tag != "" {
		if err := backup.ValidTag(tag); err != nil {
			return err
		}
		path += "?tag=" + tag
	}
	res, err := call(http.MethodPost, path, nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

func cmdBackups(args []string) error {
	key, err := appKeyArg(args, "bay backups <name/env> [--plan]")
	if err != nil {
		return err
	}
	if err := checkFlags(args[1:], map[string]bool{"--plan": true}, nil); err != nil {
		return err
	}
	path := controlHost + "/apps/" + key + "/backups"
	if hasFlag(args, "--plan") {
		path += "?plan=1"
	}
	res, err := call(http.MethodGet, path, nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

/*
handleRestoreDismiss lifts a pending restore without restoring: the operator
has looked and the database the app started with is the one to keep.

Retention resumes from the next backup, and that is what eventually deletes
the old backups - which is why this, too, wants ?confirm=yes.
*/
func (s *server) handleRestoreDismiss(w http.ResponseWriter, r *http.Request) {
	app, ok := s.store.Get(r.PathValue("name") + "/" + r.PathValue("env"))
	if !ok {
		writeError(w, http.StatusNotFound, "unknown app")
		return
	}
	if app.RestorePending == nil {
		writeJSON(w, http.StatusOK, map[string]any{"app": app.Key(), "restorePending": false})
		return
	}
	if r.URL.Query().Get("confirm") != "yes" {
		writeError(w, http.StatusPreconditionRequired, "dismissing resumes retention, which will delete the backups taken before "+app.RestorePending.Since+"; repeat with ?confirm=yes")
		return
	}
	if err := s.store.ClearRestorePending(app.Key()); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.log.Warn("pending restore dismissed; retention resumes", "app", app.Key(), "since", app.RestorePending.Since)
	s.emit("restore.dismissed", &app, map[string]any{"since": app.RestorePending.Since, "reason": clip(app.RestorePending.Reason)})
	writeJSON(w, http.StatusOK, map[string]any{
		"app":            app.Key(),
		"restorePending": false,
		"dismissed":      *app.RestorePending,
	})
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
//
// The interval is only the built-in default now: each app's effective policy
// (global, app-declared, operator) decides its own, so the loop runs even when
// `--backup-interval 0` turned the default off — an operator may still have
// switched one app on.
func (s *server) backupLoop(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		// Loud, because silence here is indistinguishable from a working
		// schedule right up until someone needs a backup.
		s.log.Warn("scheduled backups are OFF by default (--backup-interval 0); " +
			"only apps whose backup policy turns them on are backed up")
	} else {
		s.log.Info("scheduled backups on", "default interval", interval)
	}

	// The tick is only a prompt to re-examine state, never the schedule itself —
	// that lives in the policy's `Spec().Decide`, read from the recorded
	// timestamp. So a run
	// missed while Bay was down is taken on the first tick after boot, through
	// the same code path as any other run.
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	// The bucket is asked first, so a target that is down at boot is reported
	// as such before the first backup fails against it.
	var probedAt time.Time
	probe := func() {
		if s.targets != nil && time.Since(probedAt) >= targetProbeEvery {
			probedAt = time.Now()
			s.targets.probe(ctx, s)
		}
	}
	probe()
	s.runDueBackups(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			probe()
			s.runDueBackups(ctx)
			s.runDueVerifies(ctx)
		}
	}
}

// runDueBackups backs up every app that is due, one at a time.
//
// Sequential on purpose: each backup spawns the app's own runtime to run
// `VACUUM INTO`, then gzips and uploads. Doing several at once on a 2-vCPU box
// would compete with the apps it is meant to protect. Being sequential also
// makes overlapping runs impossible without a lock.
func (s *server) runDueBackups(ctx context.Context) {
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
		policy := s.effectiveBackupPolicy(app)
		if !policy.Enabled {
			continue
		}
		if retry, ok := s.backupRetries[app.Key()]; ok && now.Before(retry.at) {
			continue
		}
		// An unreadable timestamp counts as never: backing up once too often
		// beats silently never backing up again.
		last, _ := time.Parse(time.RFC3339, app.LastBackupAt)
		if !policy.Spec().Decide(last, app.Key(), now).Due {
			continue
		}
		s.backupOne(ctx, app, now)
	}
}

// backupRetry is the scheduler's memory of an instance whose scheduled
// backups keep failing.
type backupRetry struct {
	failures int
	at       time.Time
}

/*
retryBackoff is how long the scheduler waits after the n-th failure in a row:
1m, 5m, then every 15m. Without it, a bucket that is down (or a database that
no longer opens) meant one attempt and one stored failure every minute.
*/
func retryBackoff(failures int) time.Duration {
	switch {
	case failures <= 1:
		return time.Minute
	case failures == 2:
		return 5 * time.Minute
	default:
		return 15 * time.Minute
	}
}

// backupOne runs one scheduled backup through the shared path.
//
// The outcome is already recorded and logged there; a refusal reaching here is
// a state `runDueBackups` filtered for and is worth one debug line, not a
// stored failure.
func (s *server) backupOne(ctx context.Context, app state.App, now time.Time) {
	_, err := s.backupInstanceAs(ctx, app, "schedule", "")
	var refused backupRefused
	switch {
	case err == nil:
		delete(s.backupRetries, app.Key())
	case errors.As(err, &refused):
		s.log.Debug("scheduled backup skipped", "app", app.Key(), "reason", refused.Error())
	default:
		if s.backupRetries == nil {
			s.backupRetries = map[string]backupRetry{}
		}
		r := s.backupRetries[app.Key()]
		r.failures++
		r.at = now.Add(retryBackoff(r.failures))
		s.backupRetries[app.Key()] = r
		s.log.Warn("scheduled backup will be retried", "app", app.Key(), "failures", r.failures, "at", r.at.Format(time.RFC3339))
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
//
// A failure while talking to the bucket is checked against it: when the probe
// fails too, the stage is "target", which is what tells "the bucket is down"
// apart from "this app's backup is broken".
func (s *server) recordBackupFailure(ctx context.Context, app state.App, stage string, cause error) {
	if stage == "backup" {
		stage = s.failureStage(ctx, stage, cause)
	}
	key := app.Key()
	s.log.Error("backup failed", "app", key, "stage", stage, "err", cause)
	if err := s.store.RecordBackupFailureAt(key, stage, cause.Error(), time.Now()); err != nil {
		s.log.Error("could not record the backup failure", "app", key, "err", err)
	}
	consecutive := 1
	if current, ok := s.store.Get(key); ok && current.BackupFailure != nil {
		consecutive = current.BackupFailure.Consecutive
	}
	s.emit("backup.failed", &app, map[string]any{"stage": stage, "error": clip(cause.Error()), "consecutive": consecutive})
}
