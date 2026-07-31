package runner

import (
	"testing"
)

func TestParseUsageReadsAHealthyUnit(t *testing.T) {
	u := parseUsage(`MemoryCurrent=94371840
CPUUsageNSec=12500000000
TasksCurrent=17
NRestarts=2
ActiveEnterTimestamp=Thu 2026-07-30 09:14:22 UTC
MainPID=4213
`)

	if u.MemoryBytes != 94371840 {
		t.Errorf("memory: got %d", u.MemoryBytes)
	}
	if u.CPUSeconds != 12.5 {
		t.Errorf("cpu seconds: got %v", u.CPUSeconds)
	}
	if u.Tasks != 17 {
		t.Errorf("tasks: got %d", u.Tasks)
	}
	if u.Restarts != 2 {
		t.Errorf("restarts: got %d", u.Restarts)
	}
	if u.PID != 4213 {
		t.Errorf("pid: got %d", u.PID)
	}
	if u.StartedAt.Year() != 2026 || u.StartedAt.Day() != 30 {
		t.Errorf("started at: got %v", u.StartedAt)
	}
}

func TestParseUsageLeavesUnknownValuesUnset(t *testing.T) {
	// systemd says `[not set]` and `infinity` for properties the kernel does
	// not report, and it changes its mind between versions. Reporting those as
	// zero would tell an operator the app is using no memory.
	u := parseUsage(`MemoryCurrent=[not set]
CPUUsageNSec=infinity
TasksCurrent=[not set]
ActiveEnterTimestamp=
MainPID=0
NRestarts=0
`)

	if u.MemoryBytes != 0 || u.CPUSeconds != 0 || u.Tasks != 0 || u.PID != 0 {
		t.Fatalf("unparseable values must stay unset, got %+v", u)
	}
	if !u.StartedAt.IsZero() {
		t.Fatalf("a unit that never started has no start time, got %v", u.StartedAt)
	}
}

func TestParseUsageIgnoresLinesItDoesNotRecognise(t *testing.T) {
	// `systemctl show` output is not a contract. A new property, a blank line
	// or a version banner must not cost the properties Bay does understand.
	u := parseUsage(`
SomeFutureProperty=whatever
MemoryCurrent=1024
not a key value line
MemoryAvailable=999999
`)

	if u.MemoryBytes != 1024 {
		t.Fatalf("expected the known property to survive, got %+v", u)
	}
}

func TestParseUsageCountsRestartsEvenWhenNothingElseIsKnown(t *testing.T) {
	// The number that matters most: an app crash-looping every ten seconds is
	// reported as active by `is-active` between each crash.
	u := parseUsage("NRestarts=47\nMainPID=900\n")
	if u.Restarts != 47 {
		t.Fatalf("restarts: got %d", u.Restarts)
	}
}

func TestAChildProcessReportsNoUsage(t *testing.T) {
	// A child shares Bay's cgroup, so there is no budget to report against.
	// Reporting an RSS figure anyway would be a number that means something
	// else than the one the same field carries under systemd.
	if _, ok := (&Child{}).Usage("demo/production"); ok {
		t.Fatal("an unsupervised child has nothing to report")
	}
}
