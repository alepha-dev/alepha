package backup

import (
	"context"
	"fmt"
	"strings"
	"time"
)

/*
Restore points: which backup a restore or a restore test reads, and what it
found when it read it.
*/

// Restorable reports whether an entry is a database backup a restore can put
// back (a bundle or the older single file), as opposed to a service dump.
func (e Entry) Restorable() bool { return e.Kind == KindBundle || e.Kind == KindSQLite }

// Before answers the newest restorable backup taken at or before t, or false
// when every backup is newer (or there is none).
func (m *Manager) Before(ctx context.Context, app, env string, t time.Time) (Entry, bool, error) {
	entries, err := m.List(ctx, app, env)
	if err != nil {
		return Entry{}, false, err
	}
	for _, e := range entries { // newest first
		if e.Restorable() && !e.Timestamp.After(t) {
			return e, true, nil
		}
	}
	return Entry{}, false, nil
}

// restoreTimeLayouts are what `--at` accepts, read in the given location
// unless the value names its own offset.
var restoreTimeLayouts = []string{
	"2006-01-02 15:04:05",
	"2006-01-02 15:04",
	"2006-01-02T15:04:05",
	"2006-01-02T15:04",
	"2006-01-02",
}

/*
ParseRestoreTime reads a point in time for `restore --at`: RFC 3339 with its
own offset, a backup stamp (20261030T140000Z, UTC), or a wall-clock time
("2026-10-30 14:00", "2026-10-30" for its midnight) in loc - the app's
backup timezone, so the time an operator types is the one `bay backups` shows.
*/
func ParseRestoreTime(s string, loc *time.Location) (time.Time, error) {
	s = strings.TrimSpace(s)
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	if t, err := time.Parse(timeLayout, s); err == nil {
		return t, nil
	}
	if loc == nil {
		loc = time.UTC
	}
	for _, layout := range restoreTimeLayouts {
		if t, err := time.ParseInLocation(layout, s, loc); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("%q is not a time (try \"2026-10-30 14:00\", 2026-10-30, or RFC 3339)", s)
}

// VerifiedFile is one database a restore test read back.
type VerifiedFile struct {
	Path      string `json:"path"`
	Integrity string `json:"integrity"`
	Tables    int    `json:"tables"`
	// ManifestTables is what the backup recorded when it was taken; -1 when
	// the backup has no manifest to compare with.
	ManifestTables int `json:"manifestTables"`
}

// VerifyReport is a restore test's result.
type VerifyReport struct {
	Key       string         `json:"key"`
	Kind      string         `json:"kind"`
	CreatedAt time.Time      `json:"createdAt"`
	Release   string         `json:"release,omitempty"`
	Files     []VerifiedFile `json:"files"`
}

/*
VerifyBackup is a restore that stops before the app: every database is
downloaded, its checksum checked against the manifest, opened by SQLite
(integrity check), and its table count compared with the one recorded when
the backup was taken. Nothing is installed; the files are removed after.

A table count that changed means the bytes are a different database than the
one backed up, so it fails the test like a bad checksum would.
*/
func (m *Manager) VerifyBackup(ctx context.Context, key, kind string, runtime Interpreter) (*VerifyReport, error) {
	fetched, cleanup, err := m.FetchAny(ctx, key, kind, runtime)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	report := &VerifyReport{Key: key, Kind: kind}
	recorded := map[string]int{}
	if man := fetched.Manifest; man != nil {
		report.CreatedAt, report.Release = man.CreatedAt, man.Release
		for _, f := range man.Files {
			recorded[f.Path] = f.Tables
		}
	} else if ts, err := parseKeyTime(key); err == nil {
		report.CreatedAt = ts
	}
	for _, f := range fetched.Files {
		want, ok := recorded[f.Path]
		if !ok {
			want = -1
		}
		report.Files = append(report.Files, VerifiedFile{
			Path: f.Path, Integrity: f.Inspection.Integrity, Tables: f.Inspection.Tables, ManifestTables: want,
		})
		if ok && want != f.Inspection.Tables {
			return report, fmt.Errorf("%s: %d tables, the backup recorded %d", f.Path, f.Inspection.Tables, want)
		}
	}
	return report, nil
}

// FetchAny downloads and verifies a backup of either shape as a bundle: the
// older single-file snapshot is a bundle of one, app.db, without a manifest.
func (m *Manager) FetchAny(ctx context.Context, key, kind string, runtime Interpreter) (*Fetched, func(), error) {
	if kind == KindBundle {
		return m.FetchBundle(ctx, key, runtime)
	}
	local, inspection, cleanup, err := m.fetch(ctx, key, runtime)
	if err != nil {
		return nil, nil, err
	}
	return &Fetched{Files: []FetchedFile{{Path: "app.db", Local: local, Inspection: inspection}}}, cleanup, nil
}
