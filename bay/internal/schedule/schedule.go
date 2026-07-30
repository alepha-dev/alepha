// Package schedule decides when a periodic maintenance task is due.
//
// Split out from the loop that runs it so the decision is testable without a
// clock, a network, or a database — and because the decision is where the
// interesting behaviour lives.
package schedule

import "time"

// StaleAfter is how long a backup may age before it is worth complaining about,
// as a multiple of the configured interval.
//
// Not 1×: a run that starts a minute late would trip it, and a warning that
// fires routinely is a warning nobody reads.
const StaleAfter = 2

// Due reports whether the task should run now.
//
// `last` is an RFC3339 timestamp, empty when the task has never run.
//
// The decision is taken from `last` rather than from a ticker, and that is the
// point: a ticker restarts its count when the process restarts, so a run missed
// while Bay was down stays missed forever. Comparing against the recorded
// timestamp makes the catch-up fall out for free on the first tick after boot —
// the same code path as any other run, with nothing to special-case.
//
// An unparseable timestamp counts as due. It means the state was hand-edited or
// written by another version, and backing up once too often is strictly better
// than silently never backing up again.
func Due(last string, now time.Time, interval time.Duration) bool {
	if interval <= 0 {
		return false
	}
	if last == "" {
		return true
	}
	at, err := time.Parse(time.RFC3339, last)
	if err != nil {
		return true
	}
	return !now.Before(at.Add(interval))
}

// Stale reports whether the last run is old enough to warn about, and how old
// it is.
//
// Reports stale for a task that has never run, with a zero age: "no backup has
// ever been taken" is the most alarming state there is, and it must not read as
// healthy just because there is no timestamp to compare.
func Stale(last string, now time.Time, interval time.Duration) (bool, time.Duration) {
	if interval <= 0 {
		return false, 0
	}
	if last == "" {
		return true, 0
	}
	at, err := time.Parse(time.RFC3339, last)
	if err != nil {
		return true, 0
	}
	age := now.Sub(at)
	return age > StaleAfter*interval, age
}
