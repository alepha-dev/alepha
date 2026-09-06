package main

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/alepha/bay/internal/runner"
	"github.com/alepha/bay/internal/state"
)

func inventoryFixtureTime(t *testing.T) time.Time {
	t.Helper()
	now, err := time.Parse(time.RFC3339, "2026-09-06T12:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	return now
}

// The extraction's whole promise: the connector and the CLI derive the same
// facts because they call the same function. Asserted against the status line
// rather than against a copy of the rule, so a change to either one that does
// not change the other fails here.
func TestInventoryRowDerivesWhatTheStatusLineDerives(t *testing.T) {
	now := inventoryFixtureTime(t)
	app := listedApp{
		App: state.App{
			Name: "lore", Env: "production", Runtime: "node", Release: "r-42", Port: 41001,
			Domains:      []string{"lore.alepha.dev", "www.lore.alepha.dev"},
			Backups:      true,
			LastBackupAt: now.Add(-96 * time.Hour).Format(time.RFC3339),
		},
		Running: true,
		Usage:   &runner.Usage{Restarts: 2, MemoryBytes: 512 << 20, CPUSeconds: 91.5, Tasks: 17},
	}
	line := computeStatus(app, now, 24*time.Hour)
	row := inventoryRow(app, "active", now, 24*time.Hour)

	if row.BackupStale != line.BackupStale || !row.BackupStale {
		t.Fatalf("backupStale must be the status line's: row %v, line %v", row.BackupStale, line.BackupStale)
	}
	if strings.Join(row.Problems, "|") != strings.Join(line.Problems, "|") {
		t.Fatalf("problems must travel verbatim:\nrow  %v\nline %v", row.Problems, line.Problems)
	}
	if len(row.Problems) != 2 {
		t.Fatalf("want the restart and the stale backup: %v", row.Problems)
	}
	// Carried verbatim, never branched on, so the Docker runner needs no
	// change here when it lands.
	if row.Runtime != "node" {
		t.Fatalf("runtime = %q", row.Runtime)
	}
	if row.Port != 41001 || row.Release != "r-42" || len(row.Domains) != 2 {
		t.Fatalf("the raw fields the CLI does not render must travel: %+v", row)
	}
	if row.State != "active" {
		t.Fatalf("state = %q", row.State)
	}
}

// A static site is `running: false` forever and is healthy. The frame carries
// `static` so Lore can make the same distinction `bay status` makes, instead
// of drawing a red badge on a site that is serving perfectly.
func TestInventoryRowCarriesStaticSoASiteIsNotReadAsDown(t *testing.T) {
	now := inventoryFixtureTime(t)
	site := listedApp{
		App:     state.App{Name: "docs", Env: "production", Static: true},
		Running: false,
	}
	row := inventoryRow(site, "inactive", now, 24*time.Hour)
	if !row.Static {
		t.Fatal("static must travel")
	}
	if len(row.Problems) != 0 {
		t.Fatalf("a static site is not a problem: %v", row.Problems)
	}
	if row.Running {
		t.Fatal("a static site has no process, and the frame must say so")
	}
}

// `Usage` is a pointer and is legitimately nil: an unsupervised child process
// or an app that is not running has none. Absent, never zero — "0 restarts"
// from a supervisor that measured nothing is a claim, not a reading.
func TestInventoryRowLeavesUsageAbsentRatherThanZero(t *testing.T) {
	now := inventoryFixtureTime(t)
	unsupervised := listedApp{App: state.App{Name: "api", Env: "dev"}, Running: true}
	row := inventoryRow(unsupervised, "active", now, 24*time.Hour)
	if row.Restarts != nil || row.MemoryBytes != nil || row.CPUSeconds != nil || row.Tasks != nil {
		t.Fatalf("a nil Usage must leave every field it feeds absent: %+v", row)
	}
	if row.StartedAt != "" {
		t.Fatalf("startedAt = %q, want absent", row.StartedAt)
	}
	encoded, err := json.Marshal(row)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"memoryBytes", "cpuSeconds", "tasks", "restarts", "startedAt"} {
		if strings.Contains(string(encoded), `"`+key+`"`) {
			t.Fatalf("%s must not appear on the wire for an unsupervised app: %s", key, encoded)
		}
	}

	// A measured zero is a different fact from an absent one, and it travels.
	started := now.Add(-2 * time.Hour)
	supervised := listedApp{
		App: state.App{Name: "api", Env: "dev"}, Running: true,
		Usage: &runner.Usage{Restarts: 0, MemoryBytes: 0, StartedAt: started},
	}
	row = inventoryRow(supervised, "active", now, 24*time.Hour)
	if row.Restarts == nil || *row.Restarts != 0 {
		t.Fatalf("a measured zero must travel: %v", row.Restarts)
	}
	if row.StartedAt != started.UTC().Format(time.RFC3339) {
		t.Fatalf("startedAt = %q", row.StartedAt)
	}
	encoded, err = json.Marshal(row)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"restarts":0`) {
		t.Fatalf("a measured zero must reach the wire: %s", encoded)
	}
}

// Rendered durations are `bay status`'s output for a terminal. Lore renders
// its own from the timestamps in the viewer's locale, and a duration frozen at
// push time is wrong on the page a minute later.
func TestInventoryRowKeepsRenderedDurationsOffTheWire(t *testing.T) {
	now := inventoryFixtureTime(t)
	app := listedApp{
		App: state.App{
			Name: "lore", Env: "production", Backups: true,
			LastBackupAt:  now.Add(-3 * time.Hour).Format(time.RFC3339),
			LastRequestAt: now.Add(-90 * time.Minute).Format(time.RFC3339),
		},
		Running: true,
		Usage:   &runner.Usage{StartedAt: now.Add(-50 * time.Hour)},
	}
	// The status line does render them, which is what makes this a real
	// exclusion rather than a vacuous one.
	line := computeStatus(app, now, 24*time.Hour)
	if line.Uptime == "" || line.IdleFor == "" || line.BackupAge == "" {
		t.Fatalf("fixture error: the status line must render all three: %+v", line)
	}
	encoded, err := json.Marshal(inventoryRow(app, "active", now, 24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"uptime", "idleFor", "backupAge"} {
		if strings.Contains(string(encoded), `"`+key+`"`) {
			t.Fatalf("%s is a rendering, not a fact: %s", key, encoded)
		}
	}
	// The timestamps it renders from do travel.
	for _, key := range []string{"lastBackupAt", "lastRequestAt", "startedAt"} {
		if !strings.Contains(string(encoded), `"`+key+`"`) {
			t.Fatalf("%s must travel: %s", key, encoded)
		}
	}
}

// The extraction must not have moved a byte of what `bay status --json`
// prints: it is a documented output read by scripts, and the JSON is pinned
// here rather than recomputed, so a reordered field or a renamed key fails.
func TestPrintStatusJSONOutputIsUnchangedByTheExtraction(t *testing.T) {
	now := inventoryFixtureTime(t)
	apps := []listedApp{
		{
			App: state.App{
				Name: "lore", Env: "production", Release: "r-42",
				Domains: []string{"lore.alepha.dev"}, Backups: true,
				LastBackupAt:  now.Add(-96 * time.Hour).Format(time.RFC3339),
				LastRequestAt: now.Add(-30 * time.Minute).Format(time.RFC3339),
				Crons:         3,
			},
			Running: true,
			// No StartedAt: `uptime` is rendered against the wall clock rather
			// than against `now`, so pinning it here would pin the time of day
			// the suite happened to run.
			Usage: &runner.Usage{Restarts: 1, MemoryBytes: 1024},
		},
		{App: state.App{Name: "docs", Env: "production", Static: true}},
	}

	got := captureStdout(t, func() {
		// Two problems on the first app, so the non-zero exit is exercised too.
		if err := printStatusJSON(apps, now, 24*time.Hour); err == nil {
			t.Fatal("problems must still fail the command")
		}
	})

	want := `[
  {
    "app": "lore",
    "env": "production",
    "domains": [
      "lore.alepha.dev"
    ],
    "release": "r-42",
    "running": true,
    "restarts": 1,
    "memoryBytes": 1024,
    "lastRequestAt": "2026-09-06T11:30:00Z",
    "idleFor": "30m0s",
    "crons": 3,
    "backups": true,
    "lastBackupAt": "2026-09-02T12:00:00Z",
    "backupAge": "96h0m0s",
    "backupStale": true,
    "problems": [
      "restarted 1 time(s)",
      "backup is stale"
    ]
  },
  {
    "app": "docs",
    "env": "production",
    "running": false,
    "static": true,
    "restarts": 0,
    "backups": false,
    "backupStale": false,
    "problems": []
  }
]
`
	if got != want {
		t.Fatalf("bay status --json changed shape:\ngot:\n%s\nwant:\n%s", got, want)
	}
}

// captureStdout runs fn with os.Stdout redirected and returns what it wrote.
func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	saved := os.Stdout
	os.Stdout = w
	done := make(chan string, 1)
	go func() {
		out, _ := io.ReadAll(r)
		done <- string(out)
	}()
	fn()
	os.Stdout = saved
	w.Close()
	return <-done
}

// The executor answers the inventory because it already holds the server: the
// stored record, the runner's view, and the supervisor's usage all come from
// `listApps`, which is the one place they are assembled.
func TestActionsInventoryReportsTheDeployedApps(t *testing.T) {
	f := deployedApp(t)
	acts := newActions(f.server)

	inv, ok := acts.Inventory(context.Background())
	if !ok {
		t.Fatal("a bay with an app must have something to report")
	}
	if inv.Type != "inventory" {
		t.Fatalf("type = %q", inv.Type)
	}
	if _, err := time.Parse(time.RFC3339, inv.At); err != nil {
		t.Fatalf("at must be RFC 3339: %q", inv.At)
	}
	// The host block is the gauge's, and the client fills it on the way out.
	if !inv.Host.Empty() {
		t.Fatalf("the executor must not invent a host reading: %+v", inv.Host)
	}
	if len(inv.Apps) != 1 {
		t.Fatalf("apps = %d, want the one deployed", len(inv.Apps))
	}
	row := inv.Apps[0]
	if row.App != "demo" || row.Env != "production" {
		t.Fatalf("row = %+v", row)
	}
	if !row.Running || row.State != "active" {
		t.Fatalf("a running app must report both truth columns: %+v", row)
	}
	// Nobody stopped it, so the intent column is false beside a live process.
	if row.Stopped {
		t.Fatal("stopped is an intent nobody expressed here")
	}
	if row.Problems == nil {
		t.Fatal("problems must be a list, never null: an empty one means nothing needs a human")
	}
}

/*
Every finished command asks for a fresh inventory, and asks for it with the
machine-wide action mutex already released.

The mutex is asserted rather than assumed: the kick tries to take it, and a
kick that ran inside the action would fail. Holding it across a push would turn
every inventory into a lock on the deploy path.
*/
func TestFinishedCommandKicksAnInventoryOutsideTheMutex(t *testing.T) {
	f := deployedApp(t)
	acts := newActions(f.server)
	kicks := 0
	acts.kick = func() {
		if !acts.mu.TryLock() {
			t.Error("the inventory kick must run outside the action mutex")
			return
		}
		acts.mu.Unlock()
		kicks++
	}
	rec := &ackRecorder{}

	acts.Command(context.Background(), restartCommand("c-kick"), rec.send)

	if got := rec.statuses(); len(got) == 0 || got[len(got)-1] != "done" {
		t.Fatalf("acks = %v, want a terminal done", got)
	}
	if kicks != 1 {
		t.Fatalf("kicks = %d, want one after the command finished", kicks)
	}
}

// A Bay with no connection has nothing to tell, and must not panic trying.
func TestFinishWithNoConnectionDoesNotKick(t *testing.T) {
	f := deployedApp(t)
	acts := newActions(f.server)
	if acts.kick != nil {
		t.Fatal("a bare executor has no connection wired")
	}
	acts.Command(context.Background(), restartCommand("c-none"), (&ackRecorder{}).send)
}
