package connector

import (
	"sort"
	"time"
)

// Report is the whole world this machine can see, as one payload.
//
// The whole world every time, never a delta. This machine keeps no cursor and
// no outbox — it rebuilds this from what is on disk and sends it again a minute
// later, which is what lets it survive its own restart with nothing to
// reconcile. The sink's uniqueness index is what turns that at-least-once
// stream into exactly-once storage.
type Report struct {
	Agent      string        `json:"agent,omitempty"`
	BaseDomain string        `json:"baseDomain,omitempty"`
	Apps       []ReportApp   `json:"apps"`
	Events     []ReportEvent `json:"events,omitempty"`
}

// ReportApp is one instance as the supervisor currently describes it.
type ReportApp struct {
	App           string   `json:"app"`
	Environment   string   `json:"environment"`
	Domains       []string `json:"domains,omitempty"`
	Release       string   `json:"release,omitempty"`
	Running       bool     `json:"running"`
	MemoryBytes   int64    `json:"memoryBytes,omitempty"`
	Restarts      int      `json:"restarts,omitempty"`
	LastRequestAt string   `json:"lastRequestAt,omitempty"`
}

// ReportEvent is something that happened, at a time.
type ReportEvent struct {
	App         string `json:"app"`
	Environment string `json:"environment"`
	Kind        string `json:"kind"`
	Release     string `json:"release,omitempty"`
	OccurredAt  string `json:"occurredAt"`
}

// maxEvents caps one payload, matching the sink's own limit.
//
// Enforced here too rather than left to the server, because a machine that
// exceeds it gets its whole report refused — and a report refused for being too
// long looks exactly like a machine that went quiet.
const maxEvents = 200

// releaseLayout is how `deploy` names a release directory.
//
// The reason there is a deploy history at all: the names are already
// timestamps, so the machine can reconstruct when each release went out without
// ever having recorded it. Nothing new is written to disk to make this work,
// which is also why it survives a Bay that was reinstalled.
const releaseLayout = "2006-01-02-150405"

// DeployEvents derives the deploy history of one instance from its release
// directory names.
//
// Best effort by design: a directory whose name does not parse is skipped
// rather than reported at the zero time, because an event stamped 1970 would
// sort to the beginning of every chart forever. `uniqueRelease` may append a
// suffix to break a collision, so the parse takes the leading timestamp and
// ignores the rest.
func DeployEvents(app, env string, releases []string) []ReportEvent {
	out := make([]ReportEvent, 0, len(releases))
	for _, release := range releases {
		at, err := time.Parse(releaseLayout, leadingStamp(release))
		if err != nil {
			continue
		}
		out = append(out, ReportEvent{
			App:         app,
			Environment: env,
			Kind:        "deploy",
			Release:     release,
			OccurredAt:  at.UTC().Format(time.RFC3339),
		})
	}
	// Newest first, so a cap keeps the recent history rather than the oldest —
	// which is the half anyone would look at.
	sort.Slice(out, func(i, j int) bool { return out[i].OccurredAt > out[j].OccurredAt })
	return out
}

// leadingStamp returns the first `len(releaseLayout)` characters of a release
// name, which is the timestamp `deploy` prefixes it with.
func leadingStamp(release string) string {
	if len(release) < len(releaseLayout) {
		return release
	}
	return release[:len(releaseLayout)]
}

// Cap trims a report's events to what the sink will accept, keeping the newest.
func (r *Report) Cap() {
	sort.Slice(r.Events, func(i, j int) bool {
		return r.Events[i].OccurredAt > r.Events[j].OccurredAt
	})
	if len(r.Events) > maxEvents {
		r.Events = r.Events[:maxEvents]
	}
}
