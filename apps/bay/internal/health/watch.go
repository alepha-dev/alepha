package health

import (
	"context"
	"time"
)

/*
Watch decides whether a freshly-deployed release is holding up.

The window that matters is the first minutes after a deploy: an app that boots,
answers once, then dies on its first real request is the failure a deploy-time
readiness check cannot catch. Anything later than that is an incident for an
operator, not something to undo automatically — rolling back an app that has
served correctly for a week because it hiccuped is worse than the hiccup.

Consecutive failures, not a ratio: one timeout during a garbage collection is
noise, three in a row is a pattern. A ratio over a long window would also fire
eventually on a healthy app, which is how automatic rollback earns a reputation
for making things worse.
*/
type Watch struct {
	Probe *Probe
	// Port the app answers on.
	Port int
	// How long after the deploy to keep watching.
	Window time.Duration
	// How often to ask.
	Interval time.Duration
	// How many consecutive failures mean the release is bad.
	Threshold int
}

// Verdict is what a completed watch concluded.
type Verdict struct {
	// Healthy is false only when the threshold was reached.
	Healthy bool
	// Reason is the last failure, for the operator to read.
	Reason string
	// Checks is how many probes ran, so a verdict from a watch that barely
	// sampled can be told from a well-observed one.
	Checks int
}

/*
Run watches until the window closes or the app fails often enough in a row.

Returns early on failure — there is nothing to gain from watching a release
that has already been judged, and every second of delay is served to users.

An app with no `/health` is reported healthy: Bay hosts whatever runs, and
"cannot be checked" must not mean "must be rolled back".
*/
func (w *Watch) Run(ctx context.Context) Verdict {
	ctx, cancel := context.WithTimeout(ctx, w.Window)
	defer cancel()

	consecutive := 0
	checks := 0
	lastReason := ""

	for {
		select {
		case <-ctx.Done():
			return Verdict{Healthy: true, Checks: checks}
		case <-time.After(w.Interval):
		}

		status, hasHealth, err := w.Probe.Check(ctx, w.Port)
		if ctx.Err() != nil {
			// The window closed mid-check; that is not a failure.
			return Verdict{Healthy: true, Checks: checks}
		}
		checks++

		switch {
		case !hasHealth && err == nil:
			// Nothing to check. Not a verdict against the release.
			return Verdict{Healthy: true, Checks: checks}
		case err != nil:
			consecutive++
			lastReason = err.Error()
		case !status.Ready:
			consecutive++
			lastReason = "app reports ready=false"
		default:
			// One good answer clears the streak: the threshold is about a
			// sustained failure, not a tally of every bad minute.
			consecutive = 0
		}

		if consecutive >= w.Threshold {
			return Verdict{Healthy: false, Reason: lastReason, Checks: checks}
		}
	}
}
