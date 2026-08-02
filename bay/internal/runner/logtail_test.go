package runner

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRotateIfLargeMovesTheFileAside(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "app.log")
	if err := os.WriteFile(path, []byte("0123456789"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := rotateIfLarge(path, 4); err != nil {
		t.Fatalf("rotateIfLarge: %v", err)
	}

	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("want the oversized log moved out of the way")
	}
	if _, err := os.Stat(path + ".1"); err != nil {
		t.Fatalf("want the previous log kept as .1: %v", err)
	}
}

// Under the ceiling, nothing moves — a restart must not cost the operator the
// lines that explain why the app went down.
func TestRotateIfLargeLeavesSmallFileAlone(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "app.log")
	if err := os.WriteFile(path, []byte("short"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := rotateIfLarge(path, 1024); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("want the log left in place")
	}
}

// Only one generation is kept: rotating twice replaces .1 rather than growing
// a .2, .3, … chain nothing prunes.
func TestRotateIfLargeKeepsOneGeneration(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "app.log")
	for i := 0; i < 2; i++ {
		if err := os.WriteFile(path, []byte("0123456789"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := rotateIfLarge(path, 4); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := os.Stat(path + ".2"); !os.IsNotExist(err) {
		t.Fatal("want no second generation")
	}
}
