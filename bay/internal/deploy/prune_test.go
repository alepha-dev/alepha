package deploy

import (
	"os"
	"path/filepath"
	"testing"
)

// remaining lists the release directories still on disk, for asserting on what
// survived rather than only on what Prune claimed to remove. The two can
// disagree, and the disk is the one that matters.
func remaining(t *testing.T, instance string) map[string]bool {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(instance, "releases"))
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]bool{}
	for _, e := range entries {
		out[e.Name()] = true
	}
	return out
}

func TestPruneKeepsTheMostRecentReleases(t *testing.T) {
	instance := t.TempDir()
	for _, name := range []string{
		"2026-07-25-100000",
		"2026-07-26-100000",
		"2026-07-27-100000",
		"2026-07-28-100000",
		"2026-07-29-100000",
	} {
		release(t, instance, name)
	}
	if err := SwapRelease(instance, "2026-07-29-100000"); err != nil {
		t.Fatal(err)
	}

	removed, err := Prune(instance, 2)
	if err != nil {
		t.Fatal(err)
	}

	left := remaining(t, instance)
	if !left["2026-07-29-100000"] || !left["2026-07-28-100000"] {
		t.Fatalf("the two most recent releases must survive, got %v", left)
	}
	if len(removed) != 3 {
		t.Fatalf("expected the three oldest removed, got %v", removed)
	}
	for _, name := range removed {
		if left[name] {
			t.Fatalf("%s was reported removed but is still on disk", name)
		}
	}
}

// The rollback case, and the reason Prune resolves `current` itself rather than
// trusting the sort order: after `bay rollback`, the serving release is an OLD
// one. Pruning by age alone would delete the running app's own directory.
func TestPruneNeverDeletesWhatCurrentPointsTo(t *testing.T) {
	instance := t.TempDir()
	for _, name := range []string{
		"2026-07-25-100000",
		"2026-07-26-100000",
		"2026-07-27-100000",
		"2026-07-28-100000",
		"2026-07-29-100000",
	} {
		release(t, instance, name)
	}
	// Rolled back to the oldest release, which is outside any keep window.
	if err := SwapRelease(instance, "2026-07-25-100000"); err != nil {
		t.Fatal(err)
	}

	removed, err := Prune(instance, 2)
	if err != nil {
		t.Fatal(err)
	}

	left := remaining(t, instance)
	if !left["2026-07-25-100000"] {
		t.Fatal("the release `current` points to was deleted")
	}
	for _, name := range removed {
		if name == "2026-07-25-100000" {
			t.Fatal("Prune reported removing the serving release")
		}
	}
	// The two newest are kept by the window, the serving one by the symlink.
	if len(left) != 3 {
		t.Fatalf("expected 2 kept by the window plus the serving one, got %v", left)
	}
}

func TestPruneDoesNothingBelowTheKeepCount(t *testing.T) {
	instance := t.TempDir()
	release(t, instance, "2026-07-28-100000")
	release(t, instance, "2026-07-29-100000")
	if err := SwapRelease(instance, "2026-07-29-100000"); err != nil {
		t.Fatal(err)
	}

	removed, err := Prune(instance, 5)
	if err != nil {
		t.Fatal(err)
	}

	if len(removed) != 0 {
		t.Fatalf("nothing should be removed below the keep count, got %v", removed)
	}
	if len(remaining(t, instance)) != 2 {
		t.Fatal("both releases must survive")
	}
}

// A keep of zero reaching this function means a misparsed flag or a zero-valued
// struct field, never an operator asking for every release to be deleted. The
// destructive reading of an obviously wrong input is the wrong one.
func TestPruneWithANonPositiveKeepDeletesNothing(t *testing.T) {
	instance := t.TempDir()
	release(t, instance, "2026-07-28-100000")
	release(t, instance, "2026-07-29-100000")

	removed, err := Prune(instance, 0)
	if err != nil {
		t.Fatal(err)
	}

	if len(removed) != 0 {
		t.Fatalf("a keep of zero must delete nothing, got %v", removed)
	}
	if len(remaining(t, instance)) != 2 {
		t.Fatal("both releases must survive a keep of zero")
	}
}

// Prune runs at startup across every app in the state, including one that has
// been registered but never successfully deployed. A hard error there would
// take Bay down on boot for an app that is merely empty.
func TestPruneToleratesAnInstanceWithNoReleasesDirectory(t *testing.T) {
	instance := t.TempDir()

	removed, err := Prune(instance, 5)
	if err != nil {
		t.Fatalf("an instance with no releases must not be an error: %v", err)
	}
	if len(removed) != 0 {
		t.Fatalf("nothing to remove, got %v", removed)
	}
}
