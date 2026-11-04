package main

import (
	"context"
	"encoding/json"
	"sort"
	"time"

	"github.com/alepha-dev/bay/internal/connector"
)

/*
Inventory is what this machine reports about itself, for the console.

The executor answers it because it already holds the server: `s.listApps()`
assembles the stored record, whether the runner considers the app up, and the
supervisor's usage when there is one, and every derived fact comes from
`computeStatus`, the same function `bay status --json` prints. There is no
second implementation of "is this backup stale" anywhere in this repository,
and that is the point.

The host block is left empty here. It comes from the gauge, which the client
owns, so the client fills it on its way out; this side knows about apps.
*/
func (a *actions) Inventory(context.Context) (connector.Inventory, bool) {
	now := time.Now()
	interval := a.s.backupInterval
	apps := a.s.listApps()
	rows := make([]connector.InventoryApp, 0, len(apps))
	configured := a.s.store.S3() != nil
	target := a.s.targets.snapshot()
	for _, app := range apps {
		row := inventoryRow(app, a.s.runner.State(app.Key()), now, interval)
		row.Backup = inventoryBackup(app, computeStatus(app, now, interval), target, configured, now)
		rows = append(rows, row)
	}
	var stacks []connector.InventoryStack
	for _, st := range a.s.store.Stacks() {
		for _, e := range st.Envs {
			row := connector.InventoryStack{Stack: st.Name, Env: e.Env, Revision: e.Revision,
				Stopped: e.Stopped, BaseDomain: e.BaseDomain, NotBackedUp: a.s.uncoveredVolumes(st.Name, e.Env)}
			for port := range e.TCP {
				row.TCP = append(row.TCP, port)
			}
			sort.Ints(row.TCP)
			stacks = append(stacks, row)
		}
	}
	return connector.Inventory{
		Type:   "inventory",
		At:     now.UTC().Format(time.RFC3339),
		Apps:   rows,
		Stacks: stacks,
	}, true
}

/*
inventoryRow is one instance on the wire: what `bay status` derives, plus the
raw fields it does not render.

⚠️ Nothing here rounds a duration into a string. `uptime`, `idleFor` and
`backupAge` are `bay status`'s rendering for a terminal; Lore renders its own
from the timestamps, in the viewer's locale, and a duration computed at push
time would be wrong on the page within a minute.

⚠️ Nil `Usage` leaves every field it feeds absent. An unsupervised child
process and an app that is not running both have none, and "0 restarts" from a
supervisor that measured nothing is a claim rather than a reading.
*/
func inventoryRow(a listedApp, state string, now time.Time, interval time.Duration) connector.InventoryApp {
	line := computeStatus(a, now, interval)
	row := connector.InventoryApp{
		App:     a.Name,
		Env:     a.Env,
		Runtime: a.Runtime,
		Release: a.Release,
		Port:    a.Port,
		Domains: a.Domains,

		Running: a.Running,
		State:   state,
		Stopped: a.Stopped,
		Static:  a.Static,

		Backups:         a.Backups,
		LastBackupAt:    a.LastBackupAt,
		BackupStale:     line.BackupStale,
		LastBackupError: a.LastBackupError,

		LastRequestAt: a.LastRequestAt,
		Crons:         a.Crons,

		Problems: line.Problems,

		Stack:       a.Stack,
		Service:     a.Service,
		ServiceKind: a.ServiceKind,
	}
	if p := a.RestorePending; p != nil {
		row.RestorePendingSince, row.RestorePendingReason = p.Since, p.Reason
	}
	if u := a.Usage; u != nil {
		restarts, memory, cpu, tasks := u.Restarts, u.MemoryBytes, u.CPUSeconds, u.Tasks
		row.Restarts, row.MemoryBytes, row.CPUSeconds, row.Tasks = &restarts, &memory, &cpu, &tasks
		if !u.StartedAt.IsZero() {
			row.StartedAt = u.StartedAt.UTC().Format(time.RFC3339)
		}
	}
	return row
}

/*
inventoryBackup is the instance's `backup` block. Nil for an instance Bay
owns no database for.

`configured` is whether a backup bucket is set; `target` what the last probe
of it said. The state word is decided here, in priority order, so the console
never has to combine fields to know which colour to use.
*/
func inventoryBackup(a listedApp, line statusLine, target targetStatus, configured bool, now time.Time) *connector.InventoryBackup {
	if a.Static || !a.Backups {
		return nil
	}
	b := &connector.InventoryBackup{NotCovered: clipAll(a.NotBackedUp, 20)}
	if configured {
		b.Target = &connector.InventoryBackupTarget{Status: target.Status, Since: target.Since,
			LastProbeAt: target.LastProbeAt, LastError: target.LastError, Bucket: target.Bucket}
	}
	if p := a.BackupPolicy; p != nil {
		pol := &connector.InventoryBackupPolicy{
			Enabled: p.Enabled, Schedule: clip(p.ScheduleWords()), Retention: clip(p.RetentionWords()),
			EverySecs: int64(p.Every / time.Second), Timezone: p.Timezone, OnDeploy: p.OnDeploy,
			Prune: p.Prune, VerifyEvery: int64(p.VerifyEvery / time.Second),
		}
		if raw, err := json.Marshal(p.Sources); err == nil {
			_ = json.Unmarshal(raw, &pol.Sources)
		}
		for field, layer := range pol.Sources {
			if layer == "" {
				delete(pol.Sources, field)
			}
		}
		b.Policy = pol
		if p.Enabled && configured {
			last, _ := time.Parse(time.RFC3339, a.LastBackupAt)
			if next := p.Spec().Decide(last, a.Key(), now).Next; !next.IsZero() {
				b.NextAt = next.UTC().Format(time.RFC3339)
			} else {
				b.NextAt = now.UTC().Format(time.RFC3339)
			}
		}
	}
	if r := a.LastBackup; r != nil {
		run := &connector.InventoryBackupRun{At: r.At, Key: r.Key, Kind: r.Kind, Trigger: r.Trigger, Tag: r.Tag,
			Release: r.Release, RawBytes: r.RawBytes, StoredBytes: r.StoredBytes, DurationMs: r.DurationMs,
			Files: r.Files, Anomalies: clipAll(r.Anomalies, 10)}
		for i, d := range r.Databases {
			if i == reportMaxDatabases {
				break
			}
			db := connector.InventoryDatabase{Path: clip(d.Path), RawBytes: d.RawBytes, StoredBytes: d.StoredBytes,
				SHA256: d.SHA256, Integrity: clip(d.Integrity), Tables: d.Tables, Pages: d.Pages,
				PageSize: d.PageSize, JournalMode: d.JournalMode}
			for j, t := range d.TopTables {
				if j == reportMaxTables {
					break
				}
				db.TopTables = append(db.TopTables, connector.InventoryTableRows{Table: clip(t.Table), Rows: t.Rows})
			}
			for j, m := range d.Migrations {
				if j == reportMaxTables {
					break
				}
				db.Migrations = append(db.Migrations, connector.InventoryMigration{Table: clip(m.Table), Count: m.Count, Last: clip(m.Last)})
			}
			run.Databases = append(run.Databases, db)
		}
		b.Last = run
	} else if a.LastBackupAt != "" {
		// Taken before Bay recorded more than the time and the key.
		b.Last = &connector.InventoryBackupRun{At: a.LastBackupAt, Key: a.LastBackupKey}
	}
	if f := a.BackupFailure; f != nil {
		b.Failure = &connector.InventoryBackupFailure{At: f.At, Stage: f.Stage, Message: clip(f.Message), Consecutive: f.Consecutive}
	} else if a.LastBackupError != "" {
		b.Failure = &connector.InventoryBackupFailure{Message: clip(a.LastBackupError), Consecutive: 1}
	}
	if c := a.BackupCatalog; c != nil {
		b.Catalog = &connector.InventoryBackupCatalog{ListedAt: c.ListedAt, Count: c.Count, TotalBytes: c.TotalBytes,
			OldestAt: c.OldestAt, NewestAt: c.NewestAt}
	}
	if a.LastVerifyAt != "" {
		b.Verify = &connector.InventoryBackupVerify{At: a.LastVerifyAt, Key: a.LastVerifyKey,
			OK: a.LastVerifyError == "", Error: clip(a.LastVerifyError)}
	}
	if r := a.LastRestore; r != nil {
		b.Restore = &connector.InventoryRestore{At: r.At, Key: r.Key, From: r.From, Reason: clip(r.Reason),
			Trigger: r.Trigger, Status: r.Status, Error: clip(r.Error), PreRestoreKey: r.PreRestoreKey}
	}
	if p := a.RestorePending; p != nil {
		b.RestorePending = &connector.InventoryRestorePending{Since: p.Since, Reason: clip(p.Reason)}
	}

	switch {
	case !configured:
		b.State = "unconfigured"
	case a.RestorePending != nil:
		b.State = "restore-pending"
	case b.Policy != nil && !b.Policy.Enabled:
		b.State = "off"
	case b.Failure != nil:
		b.State = "failing"
	case a.LastBackupAt == "":
		b.State = "never"
	case line.BackupStale:
		b.State = "stale"
	default:
		b.State = "ok"
	}
	return b
}

func clipAll(in []string, max int) []string {
	if len(in) == 0 {
		return nil
	}
	if len(in) > max {
		in = in[:max]
	}
	out := make([]string, len(in))
	for i, s := range in {
		out[i] = clip(s)
	}
	return out
}
