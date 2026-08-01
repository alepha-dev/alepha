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

/*
The OTHER release a prune must not touch, and the one neither the keep window
nor the `current` symlink covers.

After a deploy, `Result.Previous` is what `state.Release` held a moment ago —
and a manual `bay rollback` sets that to any release the operator named, not to
the second newest. So rollback-then-deploy leaves the automatic rollback target
sitting far outside the keep window, with `current` already repointed at the
release that has just landed.

Deleting it is not a lost directory, it is a lost escape route: if the new
release then fails its health window, `watchAndRollback` calls `SwapRelease` on
a path that no longer exists and the app stays on the bad release. The safety
net disappears at the one moment it is load bearing.
*/
func TestPruneNeverDeletesTheRollbackTarget(t *testing.T) {
	instance := t.TempDir()
	for _, name := range []string{
		"2026-07-20-100000", // the operator rolled back to this one
		"2026-07-21-100000",
		"2026-07-22-100000",
		"2026-07-23-100000",
		"2026-07-24-100000",
		"2026-07-25-100000",
		"2026-07-26-100000", // and then deployed this one
	} {
		release(t, instance, name)
	}
	// The deploy has already swapped `current`, so the release being rolled back
	// FROM is the only thing the symlink protects now.
	if err := SwapRelease(instance, "2026-07-26-100000"); err != nil {
		t.Fatal(err)
	}

	// Five is `defaultKeepReleases`: the bug needs the default, not a contrived
	// window, because it is the shipped configuration that loses the target.
	previous := "2026-07-20-100000"
	removed, err := Prune(instance, 5, previous)
	if err != nil {
		t.Fatal(err)
	}

	if !remaining(t, instance)[previous] {
		t.Fatalf("the rollback target was deleted; watchAndRollback has nowhere to go (removed %v)", removed)
	}
	for _, name := range removed {
		if name == previous {
			t.Fatalf("Prune reported removing the rollback target %s", previous)
		}
	}
}

// An empty name protects nothing and must not be mistaken for a release. A
// first deploy has no previous release, and callers pass `res.Previous`
// straight through rather than testing it themselves.
func TestPruneIgnoresAnEmptyProtectedName(t *testing.T) {
	instance := t.TempDir()
	for _, name := range []string{
		"2026-07-25-100000",
		"2026-07-26-100000",
		"2026-07-27-100000",
	} {
		release(t, instance, name)
	}
	if err := SwapRelease(instance, "2026-07-27-100000"); err != nil {
		t.Fatal(err)
	}

	removed, err := Prune(instance, 2, "")
	if err != nil {
		t.Fatal(err)
	}

	if len(removed) != 1 || removed[0] != "2026-07-25-100000" {
		t.Fatalf("an empty name must protect nothing, got %v", removed)
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
