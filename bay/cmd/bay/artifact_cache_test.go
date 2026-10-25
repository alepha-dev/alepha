package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
	"time"
)

/*
The artifact cache holds both compressions, and must keep holding both.

New artifacts arrive as `.tar.zst`, but a host that has been running a while
holds whatever it pulled before the change. Every one of these cases exists
because the cheap version — match `.tar.zst` and move on — fails silently: the
older files are never counted, never trimmed, and leak disk on exactly the
hosts with the most of them.
*/

func TestAnArtifactNameIsEitherCompression(t *testing.T) {
	for _, name := range []string{"abc.tar.zst", "abc.tar.gz"} {
		if !isArtifactName(name) {
			t.Fatalf("%s should be recognised as an artifact", name)
		}
	}
	for _, name := range []string{"abc.tar", "abc.txt", "partial.tar.zst.tmp"} {
		if isArtifactName(name) {
			t.Fatalf("%s is not an artifact", name)
		}
	}
}

func TestPruneTrimsBothCompressionsTogether(t *testing.T) {
	dir := t.TempDir()
	// Newest first, alternating so a prune that saw only one suffix would keep
	// a different set than one that sees both.
	names := []string{"a.tar.zst", "b.tar.gz", "c.tar.zst", "d.tar.gz"}
	now := time.Now()
	for i, name := range names {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, now, now.Add(-time.Duration(i)*time.Hour)); err != nil {
			t.Fatal(err)
		}
	}

	(&actions{}).pruneArtifacts(dir, 2)

	left := map[string]bool{}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		left[e.Name()] = true
	}
	if len(left) != 2 || !left["a.tar.zst"] || !left["b.tar.gz"] {
		t.Fatalf("prune should keep the two newest across both suffixes, left %v", left)
	}
}

// ⚠️ A cache hit is the digest, not the name. Without this an artifact pulled
// before the move is downloaded a second time under the new suffix, and the
// host ends up holding the same bytes twice.
func TestACachedGzipArtifactIsStillAHit(t *testing.T) {
	dir := t.TempDir()
	body := []byte("pretend this is an artifact")
	if err := os.WriteFile(filepath.Join(dir, digestOfBytes(body)+".tar.gz"), body, 0o644); err != nil {
		t.Fatal(err)
	}
	path, ok := cachedArtifact(dir, digestOfBytes(body))
	if !ok {
		t.Fatal("an artifact held under the old suffix must still be a cache hit")
	}
	if filepath.Base(path) != digestOfBytes(body)+".tar.gz" {
		t.Fatalf("the hit should name the file actually held, got %s", path)
	}
}

func TestAnAbsentArtifactIsNotAHit(t *testing.T) {
	if _, ok := cachedArtifact(t.TempDir(), digestOfBytes([]byte("nothing"))); ok {
		t.Fatal("nothing is held, so nothing should be reported as cached")
	}
}

func digestOfBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
