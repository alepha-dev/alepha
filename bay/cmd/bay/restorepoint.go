package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	neturl "net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/alepha-dev/bay/internal/backup"
	"github.com/alepha-dev/bay/internal/state"
)

/*
Restore and the restore test.

A restore reads one backup — the newest, the one named by --key, the newest
at or before --at, of this instance or of the one named by --from — verifies
every database in it, takes a pre-restore backup of the data it is about to
replace, then stops the app, swaps the files and starts it again. --dry-run
stops after the verify and says what would change.

The restore test (`bay backup verify`, and the policy's verify.every) is the
same read stopped before the app: a backup nobody has read back is a hope.
*/

// restoreSource is the instance whose backups a restore reads.
type restoreSource struct{ name, env string }

func (r restoreSource) key() string { return r.name + "/" + r.env }

func parseInstance(s string) (restoreSource, error) {
	name, env, ok := strings.Cut(s, "/")
	if !ok || name == "" || env == "" || strings.Contains(env, "/") {
		return restoreSource{}, fmt.Errorf("%q is not <name>/<env>", s)
	}
	return restoreSource{name, env}, nil
}

// restoreError is a refusal with the HTTP status that says why.
type restoreError struct {
	status int
	msg    string
}

func (e restoreError) Error() string { return e.msg }

/*
resolveRestoreKey picks the backup a restore or a restore test reads.

Only one of key and at. Without either, the newest database backup (a stack
service's dump is never one). `at` is read in tz, or the app's backup
timezone, so the time typed is the time `bay backups` shows.
*/
func (s *server) resolveRestoreKey(ctx context.Context, mgr *backup.Manager, app state.App, src restoreSource, q neturl.Values) (key, kind string, err error) {
	given, at := q.Get("key"), q.Get("at")
	if given != "" && at != "" {
		return "", "", restoreError{http.StatusBadRequest, "--key and --at both name a backup: give one"}
	}
	if given != "" {
		key, kind, err = backup.RestoreKey(src.name, src.env, given)
		if err != nil {
			msg := err.Error()
			if q.Get("from") == "" {
				msg += "; restoring another instance's data takes --from <name/env>"
			}
			return "", "", restoreError{http.StatusBadRequest, msg}
		}
		return key, kind, nil
	}
	when := time.Now()
	if at != "" {
		loc := s.effectiveBackupPolicy(app).Location()
		if tz := q.Get("tz"); tz != "" {
			if loc, err = time.LoadLocation(tz); err != nil {
				return "", "", restoreError{http.StatusBadRequest, fmt.Sprintf("--tz: %q is not an IANA timezone", tz)}
			}
		}
		if when, err = backup.ParseRestoreTime(at, loc); err != nil {
			return "", "", restoreError{http.StatusBadRequest, "--at: " + err.Error()}
		}
	}
	entry, found, err := mgr.Before(ctx, src.name, src.env, when)
	if err != nil {
		return "", "", restoreError{http.StatusBadGateway, "list backups of " + src.key() + ": " + err.Error()}
	}
	if !found {
		if at != "" {
			return "", "", restoreError{http.StatusNotFound, "no backup of " + src.key() + " at or before " + when.UTC().Format(time.RFC3339)}
		}
		return "", "", restoreError{http.StatusNotFound, "no backup found for " + src.key()}
	}
	return backup.RestoreKey(src.name, src.env, entry.Key)
}

func (s *server) handleRestore(w http.ResponseWriter, r *http.Request) {
	app, ok := s.store.Get(r.PathValue("name") + "/" + r.PathValue("env"))
	if !ok {
		writeError(w, http.StatusNotFound, "unknown app")
		return
	}
	q := r.URL.Query()
	dryRun := q.Get("dryRun") == "1" || q.Get("dryRun") == "true"
	if !dryRun && q.Get("confirm") != "yes" {
		writeError(w, http.StatusPreconditionRequired, "restoring overwrites the live database; repeat with ?confirm=yes")
		return
	}
	mgr, _, err := s.backupManager()
	if err != nil || mgr == nil {
		writeError(w, http.StatusPreconditionFailed, "backups are not configured: run `bay config s3:backups --endpoint URL --bucket NAME` with BAY_S3_ACCESS_KEY and BAY_S3_SECRET_KEY set")
		return
	}
	src := restoreSource{app.Name, app.Env}
	if from := q.Get("from"); from != "" {
		if src, err = parseInstance(from); err != nil {
			writeError(w, http.StatusBadRequest, "--from: "+err.Error())
			return
		}
	}
	runtime, dataDir, err := s.appPaths(app)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	key, kind, err := s.resolveRestoreKey(r.Context(), mgr, app, src, q)
	if err != nil {
		var re restoreError
		if errors.As(err, &re) {
			writeError(w, re.status, re.msg)
		} else {
			writeError(w, http.StatusBadRequest, err.Error())
		}
		return
	}

	// Verified before the app is touched: a corrupt backup must not cost the
	// working database.
	fetched, cleanup, err := mgr.FetchAny(r.Context(), key, kind, runtime)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error(), map[string]any{"key": key})
		return
	}
	defer cleanup()

	resp := map[string]any{"app": app.Key(), "files": fetchedPaths(fetched)}
	if src.key() != app.Key() {
		resp["from"] = src.key()
	}
	if man := fetched.Manifest; man != nil {
		resp["backup"] = map[string]any{
			"createdAt": man.CreatedAt, "release": man.Release, "trigger": man.Trigger, "tag": man.Tag,
		}
	}
	if dryRun {
		replaces, untouched, creates := restoreChanges(fetched, dataDir)
		resp["dryRun"] = true
		resp["wouldRestore"] = key
		resp["replaces"] = replaces
		resp["creates"] = creates
		if len(untouched) > 0 {
			resp["untouched"] = untouched
		}
		writeJSON(w, http.StatusOK, resp)
		return
	}

	// The data about to be replaced goes to the bucket first, tagged, so a
	// restore of the wrong point can itself be undone from anywhere - not
	// only from the before-restore copies left on this disk. Best effort:
	// those copies are still there when the bucket refuses.
	if present, _, _ := backup.DiscoverSQLite(dataDir); len(present) > 0 && app.BackupHook == nil {
		if out, err := s.backupInstanceAs(r.Context(), app, "restore", backup.TagPreRestore); err != nil {
			s.log.Warn("pre-restore backup failed; restoring anyway", "app", app.Key(), "err", err)
			resp["preRestoreBackup"] = map[string]any{
				"error": err.Error(),
				"kept":  "each database replaced is still kept on this disk as <file>.before-restore-*",
			}
		} else {
			resp["preRestoreBackup"] = map[string]any{"key": resultKey(out)}
		}
	}

	unlock := s.lockBackup(app.Key())
	defer unlock()
	// A restore swaps the database under the app, so it has to stop. Requests
	// wait rather than fail for the length of it.
	defer s.holdDuring(app.Key())()

	if err := s.runner.Stop(app.Key(), stopGrace); err != nil {
		writeError(w, http.StatusInternalServerError, "stop app: "+err.Error())
		return
	}
	untouched, err := backup.InstallBundle(fetched, dataDir)
	if err != nil {
		// The app was stopped above; a refused install must not also be an
		// outage. InstallBundle put back what it had already replaced, so the
		// app comes back on its own data when its main database is in place;
		// otherwise it stays stopped rather than booting on a half-written
		// file.
		msg := "install: " + err.Error()
		dbPath := filepath.Join(dataDir, "app.db")
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
	s.log.Info("database restored", "app", app.Key(), "key", key, "from", src.key())
	// The backups the guard was protecting have done their job.
	s.clearRestorePending(app.Key())
	resp["restored"] = key
	resp["previousDb"] = "each database replaced is kept alongside as <file>.before-restore-*"
	resp["notRestored"] = []string{"storage/ (uploaded files)"}
	if len(untouched) > 0 {
		resp["untouched"] = untouched
	}
	writeJSON(w, http.StatusOK, resp)
}

// restoreChanges says what installing a fetched backup into dataDir would do:
// which databases it replaces, which it leaves alone, which it creates.
func restoreChanges(f *backup.Fetched, dataDir string) (replaces, untouched, creates []string) {
	present, _, _ := backup.DiscoverSQLite(dataDir)
	here := map[string]bool{}
	for _, p := range present {
		here[p] = true
	}
	inBackup := map[string]bool{}
	for _, file := range f.Files {
		inBackup[file.Path] = true
		if here[file.Path] {
			replaces = append(replaces, file.Path)
		} else {
			creates = append(creates, file.Path)
		}
	}
	for _, p := range present {
		if !inBackup[p] {
			untouched = append(untouched, p)
		}
	}
	return replaces, untouched, creates
}

// ---------------------------------------------------------------------------
// restore test
// ---------------------------------------------------------------------------

/*
verifyInstance test-restores one backup of an app (the newest when q names
none) and records the outcome, pass or fail, so `bay status` and Lore can
tell a backup that was read back from one that was only written.
*/
func (s *server) verifyInstance(ctx context.Context, app state.App, q neturl.Values) (*backup.VerifyReport, error) {
	if app.Static || !app.Backups || app.BackupHook != nil {
		return nil, backupRefused{app.Key() + " has no database backup Bay can test (static, BYO database, or a stack service)"}
	}
	mgr, _, err := s.backupManager()
	if err != nil || mgr == nil {
		return nil, backupRefused{"backups are not configured"}
	}
	runtime, _, err := s.appPaths(app)
	if err != nil {
		return nil, err
	}
	key, kind, err := s.resolveRestoreKey(ctx, mgr, app, restoreSource{app.Name, app.Env}, q)
	if err != nil {
		var re restoreError
		if errors.As(err, &re) && re.status == http.StatusNotFound {
			return nil, backupRefused{re.msg}
		}
		return nil, err
	}
	report, err := mgr.VerifyBackup(ctx, key, kind, runtime)
	failure := ""
	if err != nil {
		failure = err.Error()
		s.log.Warn("restore test failed", "app", app.Key(), "key", key, "err", err)
	} else {
		s.log.Info("restore test passed", "app", app.Key(), "key", key)
	}
	if recErr := s.store.RecordVerify(app.Key(), key, failure, time.Now()); recErr != nil {
		s.log.Error("could not record the restore test", "app", app.Key(), "err", recErr)
	}
	if report == nil {
		report = &backup.VerifyReport{Key: key, Kind: kind}
	}
	return report, err
}

func verifyResult(app string, report *backup.VerifyReport, err error) map[string]any {
	out := map[string]any{"app": app, "ok": err == nil}
	if report != nil {
		out["key"] = report.Key
		out["createdAt"] = report.CreatedAt
		out["files"] = report.Files
	}
	if err != nil {
		out["error"] = err.Error()
	}
	return out
}

func (s *server) handleVerifyBackup(w http.ResponseWriter, r *http.Request) {
	app, ok := s.store.Get(r.PathValue("name") + "/" + r.PathValue("env"))
	if !ok {
		writeError(w, http.StatusNotFound, "unknown app")
		return
	}
	report, err := s.verifyInstance(r.Context(), app, r.URL.Query())
	var refused backupRefused
	var re restoreError
	switch {
	case errors.As(err, &refused):
		writeError(w, http.StatusPreconditionFailed, refused.reason)
	case errors.As(err, &re):
		writeError(w, re.status, re.msg)
	case err != nil:
		writeJSON(w, http.StatusUnprocessableEntity, verifyResult(app.Key(), report, err))
	default:
		writeJSON(w, http.StatusOK, verifyResult(app.Key(), report, nil))
	}
}

// handleVerifyAll test-restores the newest backup of every app that has one.
// One app's failure is its own line, never the end of the run.
func (s *server) handleVerifyAll(w http.ResponseWriter, r *http.Request) {
	results := []map[string]any{}
	failed := 0
	for _, app := range s.store.Apps() {
		if app.Static || !app.Backups || app.BackupHook != nil {
			continue
		}
		report, err := s.verifyInstance(r.Context(), app, neturl.Values{})
		var refused backupRefused
		if errors.As(err, &refused) {
			results = append(results, map[string]any{"app": app.Key(), "skipped": refused.reason})
			continue
		}
		if err != nil {
			failed++
		}
		results = append(results, verifyResult(app.Key(), report, err))
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results, "failed": failed})
}

// verifyRetryAfter is how soon a failed restore test runs again: a failure is
// worth confirming (or clearing) the same day, not a policy period later.
const verifyRetryAfter = 6 * time.Hour

/*
runDueVerifies runs the policy's restore test, at most one app per tick: each
test downloads a whole backup, and twenty of them at once after a restart
would compete with the backups themselves.
*/
func (s *server) runDueVerifies(ctx context.Context) {
	if mgr, _, err := s.backupManager(); err != nil || mgr == nil {
		return
	}
	now := time.Now()
	for _, app := range s.store.Apps() {
		if app.Static || !app.Backups || app.BackupHook != nil || app.LastBackupKey == "" {
			continue
		}
		policy := s.effectiveBackupPolicy(app)
		if policy.VerifyEvery <= 0 {
			continue
		}
		every := policy.VerifyEvery
		if app.LastVerifyError != "" {
			every = min(every, verifyRetryAfter)
		}
		last, _ := time.Parse(time.RFC3339, app.LastVerifyAt)
		if now.Sub(last) < every {
			continue
		}
		_, _ = s.verifyInstance(ctx, app, neturl.Values{})
		return
	}
}

// ---------------------------------------------------------------------------
// client commands
// ---------------------------------------------------------------------------

const restoreUsage = "bay restore <name/env> [--key K | --at TIME [--tz ZONE]] [--from <name/env>] [--dry-run] | --dismiss"

func cmdRestore(args []string) error {
	key, err := appKeyArg(args, restoreUsage)
	if err != nil {
		return err
	}
	if err := checkFlags(args[1:], map[string]bool{"--dismiss": true, "--dry-run": true},
		map[string]bool{"--key": true, "--at": true, "--tz": true, "--from": true}); err != nil {
		return err
	}
	if hasFlag(args, "--dismiss") {
		if len(args) > 2 {
			return errors.New("--dismiss takes no other flag")
		}
		res, err := call(http.MethodPost, controlHost+"/apps/"+key+"/restore/dismiss?confirm=yes", nil)
		if err != nil {
			return err
		}
		fmt.Println(res)
		return nil
	}
	q := neturl.Values{}
	for _, f := range []string{"key", "at", "tz", "from"} {
		if v := flagValue(args, "--"+f); v != "" {
			q.Set(f, v)
		}
	}
	if q.Get("key") != "" && q.Get("at") != "" {
		return errors.New("--key and --at both name a backup: give one")
	}
	if q.Get("tz") != "" && q.Get("at") == "" {
		return errors.New("--tz only says how to read --at")
	}
	if from := q.Get("from"); from != "" {
		if _, err := parseInstance(from); err != nil {
			return fmt.Errorf("--from: %w", err)
		}
	}
	if hasFlag(args, "--dry-run") {
		q.Set("dryRun", "1")
	} else {
		q.Set("confirm", "yes")
	}
	res, err := call(http.MethodPost, controlHost+"/apps/"+key+"/restore?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

const verifyUsage = "bay backup verify <name/env> [--key K | --at TIME] | --all"

func cmdBackupVerify(args []string) error {
	if len(args) == 1 && args[0] == "--all" {
		res, err := call(http.MethodPost, controlHost+"/backups/verify", nil)
		if err != nil {
			return err
		}
		fmt.Println(res)
		var out struct {
			Failed int `json:"failed"`
		}
		if json.Unmarshal([]byte(res), &out) == nil && out.Failed > 0 {
			return fmt.Errorf("%d restore test(s) failed", out.Failed)
		}
		return nil
	}
	key, err := appKeyArg(args, verifyUsage)
	if err != nil {
		return err
	}
	if err := checkFlags(args[1:], nil, map[string]bool{"--key": true, "--at": true, "--tz": true}); err != nil {
		return err
	}
	q := neturl.Values{}
	for _, f := range []string{"key", "at", "tz"} {
		if v := flagValue(args, "--"+f); v != "" {
			q.Set(f, v)
		}
	}
	path := controlHost + "/apps/" + key + "/backup/verify"
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	res, err := call(http.MethodPost, path, nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

func resultKey(o backupOutcome) string {
	if o.Result == nil {
		return ""
	}
	return o.Result.Key
}
