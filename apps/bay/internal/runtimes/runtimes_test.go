package runtimes

import (
	"os"
	"path/filepath"
	"testing"
)

func install(t *testing.T, dir, runtime, major string) {
	t.Helper()
	bin := filepath.Join(dir, runtime+"-"+major, "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, runtime), []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestResolvesDeclaredMajor(t *testing.T) {
	dir := t.TempDir()
	install(t, dir, "node", "24")
	install(t, dir, "node", "26")

	got, err := Resolve(dir, "node", "26")
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(dir, "node-26", "bin", "node")
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestFallsBackToHighestInstalled(t *testing.T) {
	dir := t.TempDir()
	install(t, dir, "node", "24")
	install(t, dir, "node", "26")

	// No major declared: Bay should still hand out a runtime it controls rather
	// than silently reaching for the system one.
	got, err := Resolve(dir, "node", "")
	if err != nil {
		t.Fatal(err)
	}
	if got != filepath.Join(dir, "node-26", "bin", "node") {
		t.Fatalf("expected the highest major, got %q", got)
	}
}

func TestSortsMajorsNumericallyNotLexically(t *testing.T) {
	dir := t.TempDir()
	install(t, dir, "node", "9")
	install(t, dir, "node", "26")

	// Lexical ordering would put "9" above "26" and hand out an ancient runtime.
	majors := Installed(dir, "node")
	if len(majors) != 2 || majors[0] != "26" {
		t.Fatalf("expected 26 first, got %v", majors)
	}
}

func TestIgnoresDirectoriesWithoutABinary(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "node-99", "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	install(t, dir, "node", "26")

	// A half-extracted or interrupted install must not shadow a working one.
	majors := Installed(dir, "node")
	if len(majors) != 1 || majors[0] != "26" {
		t.Fatalf("expected only 26, got %v", majors)
	}
}

func TestRejectsPathTraversal(t *testing.T) {
	if _, err := Resolve(t.TempDir(), "../../bin/sh", "26"); err == nil {
		t.Fatal("expected a runtime name containing a path separator to be rejected")
	}
}
