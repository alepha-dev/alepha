package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	neturl "net/url"
	"sort"
	"time"

	"github.com/alepha-dev/bay/internal/backuppolicy"
	"github.com/alepha-dev/bay/internal/connector"
	"github.com/alepha-dev/bay/internal/state"
)

/*
The console's backup verbs. Each is a `bay` subcommand run through the same
function the control API calls, so the CLI and Lore cannot drift apart:

	backups-list   bay backups        refreshCatalog
	backup-verify  bay backup verify  verifyInstance
	target-probe   bay backup doctor  targetHealth.probe
	backup-policy  bay backup config  applyOperatorPolicy
	restore        bay restore        restoreInstance

Answers that are more than a sentence go up the pull seam like `logs`, and the
ack reason keeps a one-line summary for the command row.
*/

// maxListedBackups bounds the backups-list answer; the catalog counts them all.
const maxListedBackups = 500

type listedBackup struct {
	Key   string `json:"key"`
	At    string `json:"at"`
	Bytes int64  `json:"bytes"`
	Kind  string `json:"kind,omitempty"`
	Files int    `json:"files,omitempty"`
	Tag   string `json:"tag,omitempty"`
}

type backupsListResult struct {
	Catalog   state.BackupCatalog `json:"catalog"`
	Backups   []listedBackup      `json:"backups"`
	Truncated int                 `json:"truncated,omitempty"`
}

// backupAction runs the backup verbs that are not a restore.
func (a *actions) backupAction(ctx context.Context, cmd connector.Command) (status, step, reason string) {
	key := cmd.App + "/" + cmd.Environment
	app, ok := a.s.store.Get(key)
	if !ok {
		return "failed", "", "unknown instance " + key + " on this bay"
	}
	if app.Static || !app.Backups || app.BackupHook != nil {
		return "failed", "", key + " has no database Bay backs up (static, BYO database, or a stack service)"
	}
	switch actionKind(cmd.Kind) {
	case actionBackupsList:
		return a.backupsList(ctx, cmd, app)
	case actionBackupVerify:
		return a.backupVerify(ctx, cmd, app)
	case actionTargetProbe:
		return a.targetProbe(ctx, cmd)
	case actionBackupPolicy:
		return a.backupPolicy(cmd, app)
	}
	return "failed", "", "this bay does not know how to run " + cmd.Kind
}

func (a *actions) backupsList(ctx context.Context, cmd connector.Command, app state.App) (status, step, reason string) {
	mgr, _, err := a.s.backupManager()
	if err != nil || mgr == nil {
		return "failed", "", "backups are not configured on this bay"
	}
	entries, err := a.s.refreshCatalog(ctx, mgr, app)
	if err != nil {
		return "failed", "listing", err.Error()
	}
	result := backupsListResult{Catalog: backupCatalog(entries, time.Now()), Backups: []listedBackup{}}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Timestamp.After(entries[j].Timestamp) })
	if len(entries) > maxListedBackups {
		result.Truncated = len(entries) - maxListedBackups
		entries = entries[:maxListedBackups]
	}
	for _, e := range entries {
		result.Backups = append(result.Backups, listedBackup{Key: e.Key, At: e.Timestamp.UTC().Format(time.RFC3339),
			Bytes: e.Size, Kind: e.Kind, Files: e.Files, Tag: e.Tag})
	}
	if err := a.pushPayload(ctx, cmd.ID, result); err != nil {
		return "failed", "uploading", err.Error()
	}
	return "done", "", fmt.Sprintf("%d backup(s) listed", result.Catalog.Count)
}

func (a *actions) backupVerify(ctx context.Context, cmd connector.Command, app state.App) (status, step, reason string) {
	report, err := a.s.verifyInstance(ctx, app, restoreQuery(cmd.Restore, false))
	result := verifyResult(app.Key(), report, err)
	if pushErr := a.pushPayload(ctx, cmd.ID, result); pushErr != nil && err == nil {
		return "failed", "uploading", pushErr.Error()
	}
	if err != nil {
		return "failed", "verifying", clip(err.Error())
	}
	return "done", "", "restore test passed on " + report.Key
}

func (a *actions) targetProbe(ctx context.Context, cmd connector.Command) (status, step, reason string) {
	if a.s.targets == nil {
		return "failed", "", "this bay does not watch a backup bucket"
	}
	ok := a.s.targets.probe(ctx, a.s)
	snap := a.s.targets.snapshot()
	if err := a.pushPayload(ctx, cmd.ID, snap); err != nil {
		return "failed", "uploading", err.Error()
	}
	if !ok {
		return "failed", "probing", "the backup bucket did not answer: " + clip(snap.LastError)
	}
	return "done", "", "the backup bucket answers (" + snap.Status + ")"
}

/*
backupPolicy sets the instance's operator layer, validated as `bay backup
config` validates it. JSON null or no policy at all clears it, which hands the
instance back to what the app and the host declare.
*/
func (a *actions) backupPolicy(cmd connector.Command, app state.App) (status, step, reason string) {
	if !a.latestWelcome().DeployAllowed {
		return "failed", "", "changing a backup policy from the console is turned off for this host (deployAllowed)"
	}
	var p *backuppolicy.Policy
	if raw := bytes.TrimSpace(cmd.Policy); len(raw) > 0 && !bytes.Equal(raw, []byte("null")) {
		decoded, err := backuppolicy.Decode(raw)
		if err != nil {
			return "failed", "", "policy: " + err.Error()
		}
		if err := decoded.Validate(backuppolicy.Operator); err != nil {
			return "failed", "", "policy: " + err.Error()
		}
		p = decoded.Normalize()
	}
	updated, err := a.s.applyOperatorPolicy(app, p, "console")
	if err != nil {
		return "failed", "saving", err.Error()
	}
	if p == nil {
		return "done", "", "operator policy cleared; now " + policyLine(a.s.effectiveBackupPolicy(updated))
	}
	return "done", "", "now " + policyLine(a.s.effectiveBackupPolicy(updated))
}

/*
restore overwrites the live database with a backup, through the one restore
path `bay restore` takes: a pre-restore backup first, the instance claimed so a
deploy cannot run underneath it, and the outcome recorded and reported.

⚠️ Refused without a reason, and while deployAllowed is off. A dry run needs
neither: it reads the backup and says what it would replace.
*/
func (a *actions) restore(ctx context.Context, cmd connector.Command) (status, step, reason string) {
	key := cmd.App + "/" + cmd.Environment
	app, ok := a.s.store.Get(key)
	if !ok {
		return "failed", "", "unknown instance " + key + " on this bay"
	}
	ask := cmd.Restore
	if ask == nil {
		ask = &connector.RestoreAsk{}
	}
	if !ask.DryRun {
		if !a.latestWelcome().DeployAllowed {
			return "failed", "", "restoring from the console is turned off for this host (deployAllowed)"
		}
		if ask.Reason == "" {
			return "failed", "", "a restore overwrites the live database: say why (reason), or ask for a dry run"
		}
	}
	resp, err := a.s.restoreInstance(ctx, app, restoreQuery(ask, true),
		restoreOptions{DryRun: ask.DryRun, Reason: clip(ask.Reason), Trigger: "console"})
	if err != nil {
		var re restoreError
		if errors.As(err, &re) {
			if re.status == http.StatusConflict {
				return "failed", "", re.msg
			}
			return "failed", "restoring", re.msg
		}
		return "failed", "restoring", err.Error()
	}
	if pushErr := a.pushPayload(ctx, cmd.ID, resp); pushErr != nil {
		// The restore happened; only the details did not make it up.
		a.s.log.Warn("restore done, its details could not be uploaded", "app", key, "err", pushErr)
	}
	if ask.DryRun {
		return "done", "", "dry run: nothing was changed"
	}
	if after, ok := a.s.store.Get(key); ok && after.LastRestore != nil {
		r := after.LastRestore
		if r.PreRestoreKey != "" {
			return "done", "", "restored " + r.Key + "; the database it replaced is backed up as " + r.PreRestoreKey
		}
		return "done", "", "restored " + r.Key + "; the database it replaced is kept on disk as <file>.before-restore-*"
	}
	return "done", "", "restored"
}

// restoreQuery turns a RestoreAsk into the query `bay restore` sends.
func restoreQuery(ask *connector.RestoreAsk, withFrom bool) neturl.Values {
	q := neturl.Values{}
	if ask == nil {
		return q
	}
	for k, v := range map[string]string{"key": ask.Key, "at": ask.At, "tz": ask.Tz} {
		if v != "" {
			q.Set(k, v)
		}
	}
	if withFrom && ask.From != "" {
		q.Set("from", ask.From)
	}
	return q
}

// pushPayload uploads a command's answer over the pull seam, as `logs` does.
func (a *actions) pushPayload(ctx context.Context, id string, v any) error {
	body, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if len(body) > connector.MaxResultBytes {
		return fmt.Errorf("the answer is %d bytes, over the %d the console accepts", len(body), connector.MaxResultBytes)
	}
	cfg, ok, err := connector.NewStore(a.s.root).Load()
	if err != nil || !ok {
		return errors.New("no connector is configured on this bay, so there is nowhere to send the answer")
	}
	client := &http.Client{Timeout: connector.FetchTimeout}
	return connector.PushResult(ctx, client, cfg, id, body)
}
