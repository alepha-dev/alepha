package schedule

import (
	"testing"
	"time"
)

const day = 24 * time.Hour

func at(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

func TestDueWhenNeverRun(t *testing.T) {
	// The first boot after configuring backups must take one, not wait a day.
	if !Due("", at("2026-07-30T12:00:00Z"), day) {
		t.Fatal("a task that has never run is due")
	}
}

func TestNotDueWithinTheInterval(t *testing.T) {
	if Due("2026-07-30T12:00:00Z", at("2026-07-30T20:00:00Z"), day) {
		t.Fatal("8h into a 24h interval is not due")
	}
}

func TestDueOnTheBoundary(t *testing.T) {
	// Exactly one interval later counts as due. The alternative drifts the
	// schedule later by one tick every single day.
	if !Due("2026-07-30T12:00:00Z", at("2026-07-31T12:00:00Z"), day) {
		t.Fatal("exactly one interval later is due")
	}
}

func TestCatchesUpAfterDowntime(t *testing.T) {
	// The reason the decision is taken from the timestamp and not from a ticker:
	// Bay was down over the scheduled run, and a ticker would have restarted its
	// count from boot, leaving the missed run missed forever.
	if !Due("2026-07-28T12:00:00Z", at("2026-07-30T12:00:00Z"), day) {
		t.Fatal("a run missed during downtime must happen on the first tick")
	}
}

func TestUnparseableTimestampIsDue(t *testing.T) {
	// Hand-edited or written by another version. Backing up once too often beats
	// silently never backing up again.
	if !Due("not a timestamp", at("2026-07-30T12:00:00Z"), day) {
		t.Fatal("an unreadable timestamp must not disable backups")
	}
}

func TestZeroIntervalDisables(t *testing.T) {
	if Due("", at("2026-07-30T12:00:00Z"), 0) {
		t.Fatal("a zero interval disables the schedule")
	}
	if stale, _ := Stale("", at("2026-07-30T12:00:00Z"), 0); stale {
		t.Fatal("nothing is stale when the schedule is off")
	}
}

func TestStaleNeedsMoreThanOneInterval(t *testing.T) {
	// A run that starts slightly late must not warn — a warning that fires
	// routinely is one nobody reads.
	if stale, _ := Stale("2026-07-30T12:00:00Z", at("2026-07-31T13:00:00Z"), day); stale {
		t.Fatal("25h into a 24h interval is late, not alarming")
	}
	stale, age := Stale("2026-07-27T12:00:00Z", at("2026-07-30T12:00:00Z"), day)
	if !stale {
		t.Fatal("three days without a backup is stale")
	}
	if age != 3*day {
		t.Fatalf("age should be reported for the message, got %v", age)
	}
}

func TestNeverBackedUpIsStale(t *testing.T) {
	// The most alarming state there is; it must not read as healthy just because
	// there is no timestamp to compare against.
	stale, age := Stale("", at("2026-07-30T12:00:00Z"), day)
	if !stale {
		t.Fatal("an app that has never been backed up is stale")
	}
	if age != 0 {
		t.Fatalf("no age to report when it never ran, got %v", age)
	}
}
