package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/alepha-dev/bay/internal/backup"
	"github.com/alepha-dev/bay/internal/state"
)

/*
What a backup tells Lore about itself, built from the bundle's manifest.

Metadata only, never data: sizes, a checksum, row counts of the biggest
tables, the migration journal. Bounded everywhere, because it rides every
inventory push and a database with three hundred tables must not turn one
into a megabyte.
*/

const (
	reportMaxDatabases = 20
	reportMaxTables    = 5
	reportMaxText      = 500

	// A database that shrank by half or more since the last backup is worth a
	// warning, unless it was tiny anyway (an empty schema "halving" is noise).
	anomalyShrinkFloor = 64 << 10
)

func clip(s string) string {
	if len(s) <= reportMaxText {
		return s
	}
	return s[:reportMaxText-1] + "…"
}

// backupRecord turns a finished backup into what the store keeps.
func backupRecord(res *backup.Result, manifest *backup.Manifest, trigger, tag, release string, took time.Duration, at time.Time) state.BackupRecord {
	rec := state.BackupRecord{
		At: at.UTC().Format(time.RFC3339), Key: res.Key, Kind: res.Kind,
		Trigger: trigger, Tag: tag, Release: release,
		RawBytes: res.RawBytes, StoredBytes: res.StoredBytes,
		DurationMs: took.Milliseconds(), Files: len(res.Files),
	}
	if rec.Files == 0 {
		rec.Files = 1
	}
	if manifest == nil {
		return rec
	}
	for i, f := range manifest.Files {
		if i == reportMaxDatabases {
			break
		}
		db := state.DatabaseRecord{
			Path: clip(f.Path), RawBytes: f.RawBytes, StoredBytes: f.StoredBytes, SHA256: f.SHA256,
			Integrity: clip(f.Integrity), Tables: f.Tables, PageSize: f.PageSize, Pages: f.Pages,
			FreePages: f.FreePages, JournalMode: f.JournalMode,
		}
		for j, t := range f.TableRows {
			if j == reportMaxTables {
				break
			}
			db.TopTables = append(db.TopTables, state.TableCount{Table: clip(t.Table), Rows: t.Rows})
		}
		for j, m := range f.Migrations {
			if j == reportMaxTables {
				break
			}
			db.Migrations = append(db.Migrations, state.MigrationRecord{Table: clip(m.Table), Count: m.Count, Last: clip(m.Last)})
		}
		rec.Databases = append(rec.Databases, db)
	}
	return rec
}

/*
backupAnomalies compares a backup with the one before it.

A warning, never a refusal: a table emptied on purpose is a legitimate state,
and refusing to back it up would leave the old data as the newest backup with
nobody told. What the warning buys is that "the app wiped its users table at
3am" is read in Lore the next morning rather than found during a restore.
*/
func backupAnomalies(prev *state.BackupRecord, cur state.BackupRecord) []string {
	if prev == nil || len(prev.Databases) == 0 {
		return nil
	}
	var out []string
	now := map[string]state.DatabaseRecord{}
	for _, db := range cur.Databases {
		now[db.Path] = db
	}
	for _, before := range prev.Databases {
		after, ok := now[before.Path]
		if !ok {
			// Bounded lists make "missing" ambiguous past the cap.
			if len(cur.Databases) < reportMaxDatabases {
				out = append(out, fmt.Sprintf("database %s is gone since the previous backup", before.Path))
			}
			continue
		}
		if before.RawBytes >= anomalyShrinkFloor && after.RawBytes*2 <= before.RawBytes {
			out = append(out, fmt.Sprintf("database %s shrank from %d to %d bytes", before.Path, before.RawBytes, after.RawBytes))
		}
		rows := map[string]int64{}
		for _, t := range after.TopTables {
			rows[t.Table] = t.Rows
		}
		for _, t := range before.TopTables {
			if n, ok := rows[t.Table]; ok && t.Rows > 0 && n == 0 {
				out = append(out, fmt.Sprintf("table %s of %s is now empty (had %d rows)", t.Table, before.Path, t.Rows))
			}
		}
		if after.Integrity != "" && after.Integrity != "ok" {
			out = append(out, clip(fmt.Sprintf("database %s integrity: %s", after.Path, after.Integrity)))
		}
	}
	if len(out) > 10 {
		out = out[:10]
	}
	return out
}

// backupCatalog summarises a listing: newest first or not, it does not care.
func backupCatalog(entries []backup.Entry, at time.Time) state.BackupCatalog {
	c := state.BackupCatalog{ListedAt: at.UTC().Format(time.RFC3339), Count: len(entries)}
	var oldest, newest time.Time
	for _, e := range entries {
		c.TotalBytes += e.Size
		if oldest.IsZero() || e.Timestamp.Before(oldest) {
			oldest = e.Timestamp
		}
		if e.Timestamp.After(newest) {
			newest = e.Timestamp
		}
	}
	if !oldest.IsZero() {
		c.OldestAt = oldest.UTC().Format(time.RFC3339)
		c.NewestAt = newest.UTC().Format(time.RFC3339)
	}
	return c
}

// refreshCatalog lists an instance's backups and stores the summary. Best
// effort: a listing that fails leaves the previous summary standing.
func (s *server) refreshCatalog(ctx context.Context, mgr *backup.Manager, app state.App) ([]backup.Entry, error) {
	entries, err := mgr.List(ctx, app.Name, app.Env)
	if err != nil {
		s.log.Warn("could not list backups for the catalog", "app", app.Key(), "err", err)
		return nil, err
	}
	if err := s.store.SetBackupCatalog(app.Key(), backupCatalog(entries, time.Now())); err != nil {
		s.log.Warn("could not record the backup catalog", "app", app.Key(), "err", err)
	}
	return entries, nil
}

// failureStage says whether a failure was the bucket's: when the bucket does
// not answer a probe either, the stage is "target".
func (s *server) failureStage(ctx context.Context, stage string, _ error) string {
	if s.targets != nil && !s.targets.probe(ctx, s) {
		return "target"
	}
	return stage
}

func joinAnomalies(a []string) string { return strings.Join(a, "; ") }

// recordRestore stores a restore into an instance and tells Lore.
func (s *server) recordRestore(app state.App, r state.RestoreRecord) {
	if r.At == "" {
		r.At = time.Now().UTC().Format(time.RFC3339)
	}
	r.Reason, r.Error = clip(r.Reason), clip(r.Error)
	if err := s.store.RecordRestore(app.Key(), r); err != nil {
		s.log.Error("could not record the restore", "app", app.Key(), "err", err)
	}
	kind := "restore.completed"
	switch {
	case r.Status != "done":
		kind = "restore.failed"
	case r.Trigger == "deploy":
		kind = "restore.auto"
	}
	s.emit(kind, &app, map[string]any{"key": r.Key, "from": r.From, "reason": r.Reason,
		"trigger": r.Trigger, "error": r.Error, "preRestoreKey": r.PreRestoreKey})
}

// claimInstance marks an instance busy with a deploy or a restore, so the
// other is refused rather than interleaved. It returns what holds it when
// the claim fails.
func (s *server) claimInstance(key, what string) (string, bool) {
	s.busyMu.Lock()
	defer s.busyMu.Unlock()
	if holder, ok := s.busy[key]; ok {
		return holder, false
	}
	if s.busy == nil {
		s.busy = map[string]string{}
	}
	s.busy[key] = what
	return "", true
}

func (s *server) releaseInstance(key string) {
	s.busyMu.Lock()
	delete(s.busy, key)
	s.busyMu.Unlock()
}
