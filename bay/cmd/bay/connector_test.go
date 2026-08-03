package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// token is a syntactically valid outpost bearer.
//
// Long enough that `Prefix()` truncates it, so a test that asserts on an error
// message sees the same elided form an operator would.
const token = "op_TESTTOKENTESTTOKEN"

// bayRoot builds a directory that looks like what `bay serve` runs from.
//
// `state.json` is the marker, because that is the file `serve` opens to decide
// where its world lives — anything else would be a second, drifting definition
// of "this is a Bay".
func bayRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "state.json"), []byte(`{}`), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

// A root nobody serves from must be refused, not created.
//
// The bug this pins: `connector add` resolved a RELATIVE default (`./bay-data`)
// and `write` did MkdirAll, so running it from a home directory conjured a new
// tree and reported success. `connector list` then read back the same wrong
// file — the two commands confirmed each other while the running Bay, rooted
// elsewhere, reported to nobody.
func TestConnectorAddRefusesADirectoryThatIsNotABayRoot(t *testing.T) {
	root := t.TempDir() // no state.json: never served from
	t.Setenv("BAY_ROOT", root)

	err := cmdConnector([]string{"add", token})

	if err == nil {
		t.Fatal("adding a connector to a non-Bay root must fail, not silently create one")
	}
	// The path is the whole diagnosis: an operator who sees which directory was
	// checked knows immediately whether they are in the wrong place.
	if !strings.Contains(err.Error(), root) {
		t.Errorf("error must name the directory it checked, got %q", err)
	}
	if _, statErr := os.Stat(filepath.Join(root, "connectors.json")); statErr == nil {
		t.Error("a refused add must leave no connectors.json behind")
	}
}

// The refusal has to say what to do next, or it just moves the confusion.
func TestConnectorRefusalNamesTheWayOut(t *testing.T) {
	t.Setenv("BAY_ROOT", t.TempDir())

	err := cmdConnector([]string{"add", token})

	if err == nil {
		t.Fatal("expected a refusal")
	}
	if !strings.Contains(err.Error(), "--root") {
		t.Errorf("error must point at --root, got %q", err)
	}
}

// The guard must not cost the normal case: a real root still enrolls.
func TestConnectorAddWritesIntoARealBayRoot(t *testing.T) {
	root := bayRoot(t)
	t.Setenv("BAY_ROOT", root)

	if err := cmdConnector([]string{"add", token}); err != nil {
		t.Fatalf("a real Bay root must accept a connector: %v", err)
	}

	if _, err := os.Stat(filepath.Join(root, "connectors.json")); err != nil {
		t.Fatalf("connectors.json must land beside the state it describes: %v", err)
	}
}

// `list` is held to the same standard, because it is the command an operator
// uses to CHECK the previous one. A list that reads a different file than the
// running Bay is how a wrong add gets confirmed as right.
func TestConnectorListRefusesADirectoryThatIsNotABayRoot(t *testing.T) {
	root := t.TempDir()
	t.Setenv("BAY_ROOT", root)

	err := cmdConnector([]string{"list"})

	if err == nil {
		t.Fatal("listing from a non-Bay root must fail rather than report an empty fleet")
	}
	if !strings.Contains(err.Error(), root) {
		t.Errorf("error must name the directory it checked, got %q", err)
	}
}

// An explicit --root is checked too: it catches the typo it was meant to fix.
func TestConnectorAddChecksAnExplicitRoot(t *testing.T) {
	// $BAY_ROOT is deliberately valid, so only the flag can cause the failure.
	t.Setenv("BAY_ROOT", bayRoot(t))
	typo := t.TempDir()

	err := cmdConnector([]string{"add", token, "--root", typo})

	if err == nil {
		t.Fatal("an explicit --root that is not a Bay root must be refused")
	}
	if !strings.Contains(err.Error(), typo) {
		t.Errorf("error must name the root that was given, got %q", err)
	}
}
