package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	neturl "net/url"
	"os"
	"strings"
	"time"

	"github.com/alepha-dev/bay/internal/backup"
	"github.com/alepha-dev/bay/internal/deploy"
	"github.com/alepha-dev/bay/internal/state"
)

/*
Restore and the restore test.

A restore reads one backup (the newest, the one named by --key, the newest
at or before --at, of this instance or of the one named by --from), verifies
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
	// extra goes into the error body beside the message.
	extra map[string]any
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
		return "", "", restoreError{status: http.StatusBadRequest, msg: "--key and --at both name a backup: give one"}
	}
	if given != "" {
		key, kind, err = backup.RestoreKey(src.name, src.env, given)
		if err != nil {
			msg := err.Error()
			if q.Get("from") == "" {
				msg += "; restoring another instance's data takes --from <name/env>"
			}
			return "", "", restoreError{status: http.StatusBadRequest, msg: msg}
		}
		return key, kind, nil
	}
	when := time.Now()
	// An instance that started empty has backed that empty database up since,
	// maybe: "the latest" then means the latest before it started empty.
	if at == "" && src.key() == app.Key() && app.RestorePending != nil {
		if since := app.RestorePending.SinceTime(); !since.IsZero() {
			when = beforeSecondOf(since)
		}
	}
	if at != "" {
		loc := s.effectiveBackupPolicy(app).Location()
		if tz := q.Get("tz"); tz != "" {
			if loc, err = time.LoadLocation(tz); err != nil {
				return "", "", restoreError{status: http.StatusBadRequest, msg: fmt.Sprintf("--tz: %q is not an IANA timezone", tz)}
			}
		}
		if when, err = backup.ParseRestoreTime(at, loc); err != nil {
			return "", "", restoreError{status: http.StatusBadRequest, msg: "--at: " + err.Error()}
		}
	}
	entry, found, err := mgr.Before(ctx, src.name, src.env, when)
	if err != nil {
		return "", "", restoreError{status: http.StatusBadGateway, msg: "list backups of " + src.key() + ": " + err.Error()}
	}
	if !found {
		if at != "" {
			return "", "", restoreError{status: http.StatusNotFound, msg: "no backup of " + src.key() + " at or before " + when.UTC().Format(time.RFC3339)}
		}
		return "", "", restoreError{status: http.StatusNotFound, msg: "no backup found for " + src.key()}
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
	// Detached from the request, like a deploy: a client that hangs up once
	// the app is stopped must not leave it stopped half way through.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), deployTimeout)
	defer cancel()
	// --with-key reaches here only: the restore Lore queues never carries it.
	withKey := q.Get("withKey") == "yes"
	resp, err := s.restoreInstance(ctx, app, q, restoreOptions{DryRun: dryRun, Reason: q.Get("reason"), Trigger: "cli", WithKey: withKey})
	if err != nil {
		var re restoreError
		if errors.As(err, &re) {
			writeError(w, re.status, re.msg, re.extra)
		} else {
			writeError(w, http.StatusBadRequest, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// restoreOptions is what a restore is asked to do beyond which backup.
type restoreOptions struct {
	DryRun bool
	// Reason is why, recorded with the restore and sent to Lore.
	Reason string
	// Trigger is what asked: "cli" or "console".
	Trigger string
	// WithKey replaces the instance's APP_SECRET with the backup's, together
	// with its databases (`bay restore --with-key`, the CLI only).
	WithKey bool
}

/*
restoreInstance is the one restore path, behind `bay restore` and the
console's restore action alike, so both are recorded and reported the same
way.

q names the backup (key, at, tz, from: see resolveRestoreKey). A refusal is a
restoreError carrying the HTTP status that says why; every failure after the
backup has been chosen is recorded as a failed restore.
*/
func (s *server) restoreInstance(ctx context.Context, app state.App, q neturl.Values, opts restoreOptions) (map[string]any, error) {
	mgr, _, err := s.backupManager()
	if err != nil || mgr == nil {
		return nil, restoreError{status: http.StatusPreconditionFailed, msg: "backups are not configured: run `bay config s3:backups --endpoint URL --bucket NAME` with BAY_S3_ACCESS_KEY and BAY_S3_SECRET_KEY set"}
	}
	src := restoreSource{app.Name, app.Env}
	if from := q.Get("from"); from != "" {
		if src, err = parseInstance(from); err != nil {
			return nil, restoreError{status: http.StatusBadRequest, msg: "--from: " + err.Error()}
		}
	}
	// Another instance's key never crosses, not even by request.
	if opts.WithKey && src.key() != app.Key() {
		return nil, restoreError{status: http.StatusBadRequest,
			msg: "--with-key restores a backup's own key into its own instance: it cannot be used with --from"}
	}
	// Read before the restore clears it.
	pending := app.RestorePending != nil
	runtime, dataDir, err := s.appPaths(app)
	if err != nil {
		return nil, restoreError{status: http.StatusInternalServerError, msg: err.Error()}
	}
	key, kind, err := s.resolveRestoreKey(ctx, mgr, app, src, q)
	if err != nil {
		return nil, err
	}

	// From here on the restore is about a named backup, and how it ends is
	// recorded either way.
	rec := state.RestoreRecord{Key: key, Reason: opts.Reason, Trigger: opts.Trigger}
	if src.key() != app.Key() {
		rec.From = src.key()
	}
	fail := func(status int, msg string, extra map[string]any) (map[string]any, error) {
		if !opts.DryRun {
			rec.Status, rec.Error = "failed", msg
			s.recordRestore(app, rec)
		}
		return nil, restoreError{status: status, msg: msg, extra: extra}
	}

	// A deploy swapping the release under the restore, or the other way
	// round, leaves an app nobody can describe. A dry run touches nothing.
	if !opts.DryRun {
		release, ok := s.claimInstance(app.Key(), "restore")
		if !ok {
			return nil, restoreError{status: http.StatusConflict, msg: app.Key() + " is busy (" + release + "): try again once it is done"}
		}
		defer s.releaseInstance(app.Key())
	}

	// Verified before the app is touched: a corrupt backup must not cost the
	// working database.
	fetched, cleanup, err := mgr.FetchAny(ctx, key, kind, runtime)
	if err != nil {
		return fail(http.StatusBadGateway, err.Error(), map[string]any{"key": key})
	}
	defer cleanup()

	if opts.WithKey && fetched.AppSecretStatus() != backup.SecretCarried {
		return nil, restoreError{status: http.StatusPreconditionFailed,
			msg: key + " carries no APP_SECRET (" + fetched.AppSecretStatus() + "): --with-key has no key to restore"}
	}
	current, err := deploy.ReadAppSecret(s.instanceDir(app))
	if err != nil {
		return nil, restoreError{status: http.StatusInternalServerError, msg: "read the instance's APP_SECRET: " + err.Error()}
	}
	plan := planSecretRestore(fetched, secretInput{
		app: app, sameInstance: src.key() == app.Key(), current: current, pending: pending, withKey: opts.WithKey,
	})
	rec.WithKey = opts.WithKey

	resp := map[string]any{"app": app.Key(), "files": fetchedPaths(fetched)}
	if src.key() != app.Key() {
		resp["from"] = src.key()
	}
	if man := fetched.Manifest; man != nil {
		resp["backup"] = map[string]any{
			"createdAt": man.CreatedAt, "release": man.Release, "trigger": man.Trigger, "tag": man.Tag,
		}
	}
	if opts.DryRun {
		replaces, untouched, creates := restoreChanges(fetched, dataDir)
		resp["dryRun"] = true
		resp["wouldRestore"] = key
		resp["replaces"] = replaces
		resp["creates"] = creates
		if len(untouched) > 0 {
			resp["untouched"] = untouched
		}
		plan.say(resp)
		return resp, nil
	}

	// The data about to be replaced goes to the bucket first, tagged, so a
	// restore of the wrong point can itself be undone from anywhere - not
	// only from the before-restore copies left on this disk. Best effort:
	// those copies are still there when the bucket refuses.
	if present, _, _ := backup.DiscoverSQLite(dataDir); len(present) > 0 && app.BackupHook == nil {
		if out, err := s.backupInstanceAs(ctx, app, "restore", backup.TagPreRestore); err != nil {
			s.log.Warn("pre-restore backup failed; restoring anyway", "app", app.Key(), "err", err)
			resp["preRestoreBackup"] = map[string]any{
				"error": err.Error(),
				"kept":  "each database replaced is still kept on this disk as <file>.before-restore-*",
			}
		} else {
			rec.PreRestoreKey = resultKey(out)
			resp["preRestoreBackup"] = map[string]any{"key": rec.PreRestoreKey}
		}
	}

	unlock := s.lockBackup(app.Key())
	defer unlock()
	// A restore swaps the database under the app, so it has to stop. Requests
	// wait rather than fail for the length of it.
	defer s.holdDuring(app.Key())()

	if err := s.stopForMaintenance(app.Key()); err != nil {
		return fail(http.StatusInternalServerError, "stop app: "+err.Error(), nil)
	}
	untouched, err := installBundle(fetched, dataDir)
	if err != nil {
		// The app was stopped above; a refused install must not also be an
		// outage. InstallBundle puts back what it had already replaced, and
		// says when it could not: only then does the app stay stopped rather
		// than boot on a half-restored directory.
		msg := "install: " + err.Error()
		var notBack *backup.NotRolledBackError
		if errors.As(err, &notBack) {
			msg += "; the app is left stopped: its data directory is half restored, the databases replaced are kept as <file>.before-restore-*"
		} else if startErr := s.start(app); startErr != nil {
			msg += "; and the app did not come back: " + startErr.Error()
		} else {
			msg += "; the app is back on its current database"
		}
		return fail(http.StatusInternalServerError, msg, nil)
	}
	// The key with its databases, while the app is stopped, so it starts on
	// the key its restored data was sealed with.
	plan = s.applySecretPlan(app, plan)
	rec.AppSecret = plan.outcome
	s.recordRestoredSecret(app, &plan, src.key() == app.Key(), pending)
	plan.say(resp)
	// The data is back the moment the install succeeds: the backups the guards
	// were protecting have done their job, whether or not the app boots on it.
	s.clearRestorePending(app.Key())
	if err := s.start(app); err != nil {
		// The restore itself is done: recorded so, with the boot failure said,
		// or the console would invite a second restore of data already back.
		msg := "database restored but the app did not come back: " + err.Error()
		rec.Status, rec.Error = "done", msg
		s.recordRestore(app, rec)
		return nil, restoreError{status: http.StatusBadGateway, msg: msg, extra: map[string]any{"restored": key}}
	}
	s.log.Info("database restored", "app", app.Key(), "key", key, "from", src.key(), "by", opts.Trigger,
		"appSecret", plan.outcome, "withKey", opts.WithKey)
	rec.Status = "done"
	s.recordRestore(app, rec)
	resp["restored"] = key
	resp["previousDb"] = "each database replaced is kept alongside as <file>.before-restore-*"
	resp["notRestored"] = []string{"storage/ (uploaded files)"}
	if len(untouched) > 0 {
		resp["untouched"] = untouched
	}
	return resp, nil
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
	if failure == "" {
		s.emit("verify.passed", &app, map[string]any{"key": key})
	} else {
		s.emit("verify.failed", &app, map[string]any{"key": key, "error": clip(failure)})
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
		if report.AppSecret != "" {
			out["appSecret"] = report.AppSecret
		}
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

const restoreUsage = "bay restore <name/env> [--key K | --at TIME [--tz ZONE]] [--from <name/env>] [--dry-run] [--with-key [--yes]] | --dismiss"

func cmdRestore(args []string) error {
	key, err := appKeyArg(args, restoreUsage)
	if err != nil {
		return err
	}
	if err := checkFlags(args[1:], map[string]bool{"--dismiss": true, "--dry-run": true, "--with-key": true, "--yes": true},
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
	withKey := hasFlag(args, "--with-key")
	if hasFlag(args, "--yes") && !withKey {
		return errors.New("--yes confirms --with-key, and only that")
	}
	if withKey {
		if q.Get("from") != "" {
			return errors.New("--with-key restores a backup's own key into its own instance: it cannot be used with --from")
		}
		q.Set("withKey", "yes")
	}
	if hasFlag(args, "--dry-run") {
		q.Set("dryRun", "1")
	} else {
		if withKey && !hasFlag(args, "--yes") {
			fmt.Fprintf(os.Stderr, "--with-key replaces the APP_SECRET of %[1]s with the backup's. Every session is signed out, "+
				"MFA enrolled since that backup is lost, and the current key is gone for good. Type %[1]s to confirm: ", key)
			var typed string
			_, _ = fmt.Scanln(&typed)
			if strings.TrimSpace(typed) != key {
				return errors.New("not confirmed; nothing was restored")
			}
		}
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
