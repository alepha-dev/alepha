package runner

import (
	"strconv"
	"strings"
	"time"
)

/*
Usage is what the supervisor knows about an app at this instant.

A snapshot, deliberately: no history, no averaging, no series. The question it
answers is the one an operator asks when something is wrong right now — is this
app eating memory, has it been restarting, how long has it actually been up.
History is a different product with different storage, and putting a ring
buffer in the orchestrator would mean Bay losing it on every upgrade anyway.

Every field is optional. Bay hosts apps under plain child processes during
development, where none of this exists, and a supervisor that reports zeros
would be worse than one that reports nothing — zero memory reads as a fact.
*/
type Usage struct {
	// MemoryBytes is the cgroup's current charge, which includes page cache
	// the app has touched. It is what MemoryMax is enforced against, so it is
	// the number that predicts an OOM kill — not the smaller RSS figure.
	MemoryBytes int64 `json:"memoryBytes,omitempty"`
	// CPUSeconds is consumed CPU time since the unit last started. Cumulative:
	// two readings and the interval between them give a rate, which is the
	// caller's job.
	CPUSeconds float64 `json:"cpuSeconds,omitempty"`
	// Tasks is threads plus processes, against TasksMax.
	Tasks int `json:"tasks,omitempty"`
	// Restarts counts automatic restarts since the unit was last started by
	// hand. The single most useful number here: an app quietly crash-looping
	// looks perfectly healthy from the outside.
	Restarts int `json:"restarts"`
	// StartedAt is when the current run began, so a restart a minute ago is
	// distinguishable from an uptime of weeks.
	StartedAt time.Time `json:"startedAt,omitzero"`
	// PID of the main process, for an operator who needs to go further.
	PID int `json:"pid,omitempty"`
}

// usageProperties are asked for by name so the output stays small and its shape
// stays fixed — `systemctl show` with no filter prints upwards of two hundred
// lines whose contents drift between systemd versions.
var usageProperties = []string{
	"MemoryCurrent",
	"CPUUsageNSec",
	"TasksCurrent",
	"NRestarts",
	"ActiveEnterTimestamp",
	"MainPID",
}

/*
parseUsage reads `systemctl show` output into a Usage.

systemd reports absent values as `[not set]`, `infinity`, or `0` depending on
the property and the kernel's cgroup support, and it changes its mind between
versions. Anything that does not parse as a number is left at its zero value
and omitted from the response, which is the honest answer: Bay does not know.
*/
func parseUsage(out string) Usage {
	var u Usage
	for _, line := range strings.Split(out, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok {
			continue
		}
		switch key {
		case "MemoryCurrent":
			if n, err := strconv.ParseInt(value, 10, 64); err == nil {
				u.MemoryBytes = n
			}
		case "CPUUsageNSec":
			if n, err := strconv.ParseInt(value, 10, 64); err == nil {
				u.CPUSeconds = float64(n) / 1e9
			}
		case "TasksCurrent":
			if n, err := strconv.Atoi(value); err == nil {
				u.Tasks = n
			}
		case "NRestarts":
			if n, err := strconv.Atoi(value); err == nil {
				u.Restarts = n
			}
		case "MainPID":
			if n, err := strconv.Atoi(value); err == nil && n > 0 {
				u.PID = n
			}
		case "ActiveEnterTimestamp":
			// systemd's own format, e.g. "Thu 2026-07-31 09:14:22 UTC". Empty
			// for a unit that has never started.
			if t, err := time.Parse("Mon 2006-01-02 15:04:05 MST", value); err == nil {
				u.StartedAt = t
			}
		}
	}
	return u
}
