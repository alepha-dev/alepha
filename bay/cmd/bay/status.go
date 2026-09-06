package main

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/alepha/bay/internal/schedule"
)

// statusLine is one instance as `bay status --json` reports it.
//
// A computed view rather than the raw control API record. The whole value of
// this command is the arithmetic — how old is that backup, is it late, has this
// app answered anything lately — and an agent that has to redo it against a
// timestamp will get the timezone wrong eventually.
type statusLine struct {
	App     string   `json:"app"`
	Env     string   `json:"env"`
	Domains []string `json:"domains,omitempty"`
	Release string   `json:"release,omitempty"`

	Running bool `json:"running"`
	// Static reports a site served from disk. Carried so a reader seeing no
	// uptime, no memory and no restarts knows it is looking at a site with no
	// process rather than at a supervisor that has lost track of one.
	Static      bool   `json:"static,omitempty"`
	Restarts    int    `json:"restarts"`
	Uptime      string `json:"uptime,omitempty"`
	MemoryBytes int64  `json:"memoryBytes,omitempty"`

	LastRequestAt string `json:"lastRequestAt,omitempty"`
	IdleFor       string `json:"idleFor,omitempty"`
	Crons         int    `json:"crons,omitempty"`

	Backups         bool   `json:"backups"`
	LastBackupAt    string `json:"lastBackupAt,omitempty"`
	BackupAge       string `json:"backupAge,omitempty"`
	BackupStale     bool   `json:"backupStale"`
	LastBackupError string `json:"lastBackupError,omitempty"`

	// Problems is the same set the human view marks with a warning sign, in
	// words. Present so a monitor never has to infer severity from the fields:
	// an empty list means nothing here needs a human.
	Problems []string `json:"problems"`
}

/*
computeStatus is the arithmetic, for one instance.

Extracted so it has exactly one implementation. The connector pushes the same
derived facts to Lore, and a second copy of the backup-staleness rule and the
not-running rule would drift - invisibly, because each copy looks right on its
own. `printStatusJSON` is a loop over this, and its output is unchanged.

`now` and `interval` are arguments rather than read here for the reason this
file exists at all: the whole value is the arithmetic, and arithmetic against
a clock a caller cannot move is arithmetic nobody can test.
*/
func computeStatus(a listedApp, now time.Time, interval time.Duration) statusLine {
	line := statusLine{
		App:           a.Name,
		Env:           a.Env,
		Domains:       a.Domains,
		Release:       a.Release,
		Running:       a.Running,
		Static:        a.Static,
		LastRequestAt: a.LastRequestAt,
		IdleFor:       idleFor(a.LastRequestAt, now),
		Crons:         a.Crons,
		Backups:       a.Backups,
		LastBackupAt:  a.LastBackupAt,
		Problems:      []string{},
	}
	if u := a.Usage; u != nil {
		line.Restarts = u.Restarts
		line.MemoryBytes = u.MemoryBytes
		line.Uptime = uptimeOf(u.StartedAt)
	}
	// A static site has no process, so `Running` is false for it forever.
	// Calling that a problem would make this command exit non-zero on a
	// healthy host every time it ran - and a status command that always
	// fails is one nobody reads on the day something is actually wrong.
	if !a.Running && !a.Static {
		line.Problems = append(line.Problems, "not running")
	}
	if line.Restarts > 0 {
		line.Problems = append(line.Problems, fmt.Sprintf("restarted %d time(s)", line.Restarts))
	}
	if a.Backups {
		stale, age := schedule.Stale(a.LastBackupAt, now, interval)
		if a.LastBackupAt != "" {
			line.BackupAge = age.Round(time.Minute).String()
		}
		line.BackupStale = stale
		if stale {
			line.Problems = append(line.Problems, "backup is stale")
		}
	}
	if a.LastBackupError != "" {
		line.Problems = append(line.Problems, "last backup attempt failed: "+a.LastBackupError)
	}
	return line
}

// printStatusJSON writes the machine view and fails the same way the human one
// does.
//
// Same non-zero exit on trouble: the command is documented as usable from a
// cron, and an exit status that depended on the output format would be a trap
// for whoever switched to --json to make their script simpler.
func printStatusJSON(apps []listedApp, now time.Time, interval time.Duration) error {
	lines := make([]statusLine, 0, len(apps))
	problems := 0
	for _, a := range apps {
		line := computeStatus(a, now, interval)
		problems += len(line.Problems)
		lines = append(lines, line)
	}

	encoded, err := json.MarshalIndent(lines, "", "  ")
	if err != nil {
		return err
	}
	fmt.Println(string(encoded))
	if problems > 0 {
		return fmt.Errorf("%d problem(s) above", problems)
	}
	return nil
}

// trafficLine says whether anything has reached this app lately.
//
// "never" is spelled out rather than left as an empty field: an app nobody has
// ever reached is the single most likely thing on a shared host to be safe to
// delete, and that is exactly the sentence an operator wants to read before
// they do it.
func trafficLine(a listedApp, now time.Time) string {
	suffix := ""
	if a.Crons > 0 {
		// Named because it changes the meaning of silence. An app that serves a
		// weekly email answers no requests and is not abandoned.
		suffix = fmt.Sprintf(" (%d cron(s) declared)", a.Crons)
	}
	if a.LastRequestAt == "" {
		return "never answered a request" + suffix
	}
	idle := idleFor(a.LastRequestAt, now)
	if idle == "" {
		return a.LastRequestAt + suffix
	}
	return idle + " ago" + suffix
}

// idleFor renders how long ago the last request was answered.
//
// Empty when the stamp is unparseable, so the caller can fall back to printing
// it verbatim rather than showing an invented duration.
func idleFor(lastRequestAt string, now time.Time) string {
	if lastRequestAt == "" {
		return ""
	}
	t, err := time.Parse(time.RFC3339, lastRequestAt)
	if err != nil {
		return ""
	}
	d := now.Sub(t)
	if d < 0 {
		// A stamp in the future is a clock problem, not a traffic fact. Reported
		// as "just now" rather than as a negative age, which renders as garbage.
		return "0s"
	}
	if d < time.Minute {
		return d.Round(time.Second).String()
	}
	if d < 24*time.Hour {
		return d.Round(time.Minute).String()
	}
	return fmt.Sprintf("%dd", int(d.Hours()/24))
}
