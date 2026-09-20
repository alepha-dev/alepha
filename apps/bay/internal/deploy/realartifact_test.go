package deploy

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/alepha/bay/internal/manifest"
)

// Reads the artifact `alepha pack` actually produced, rather than one this
// package built for itself. A fixture that mirrors the reader it is fed to
// cannot disagree with it; this one can.
//
// Skipped unless BAY_REAL_ARTIFACT names a file, so it never gates CI on a
// build nobody ran.
func TestReadsARealPackedArtifact(t *testing.T) {
	src := os.Getenv("BAY_REAL_ARTIFACT")
	if src == "" {
		t.Skip("set BAY_REAL_ARTIFACT to a .tar.zst produced by `alepha pack`")
	}
	dest := t.TempDir()
	if err := untar(src, dest); err != nil {
		t.Fatalf("untar: %v", err)
	}
	for _, want := range []string{"manifest.json", "index.node.js", "index.workerd.js"} {
		if _, err := os.Stat(filepath.Join(dest, want)); err != nil {
			t.Fatalf("%s should be at the archive root: %v", want, err)
		}
	}
	m, err := manifest.LoadFromRelease(dest)
	if err != nil {
		t.Fatalf("LoadFromRelease: %v", err)
	}
	t.Logf("name=%s runtime=%s entry=%s resources=%+v", m.Name, m.Runtime, m.Entry, m.Resources)
	if m.Runtime != "node" || m.Entry != "index.node.js" {
		t.Fatalf("a node+workerd artifact must spawn the node slice, got %q %q", m.Runtime, m.Entry)
	}
	if _, err := os.Stat(filepath.Join(dest, m.Entry)); err != nil {
		t.Fatalf("the entry the manifest names must exist: %v", err)
	}
}
