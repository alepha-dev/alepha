package control

import (
	"os"
	"path/filepath"
	"testing"
)

// shortDir returns a temp directory with a short path. `t.TempDir()` on macOS
// produces something like /var/folders/…/TestNameNNNNN/001, which on its own
// exceeds the 104-byte `sun_path` limit and makes every bind fail with
// `bind: invalid argument`.
func shortDir(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "bay")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}

func TestListenPublishesAnOwnerAndGroupOnlySocket(t *testing.T) {
	path := filepath.Join(shortDir(t), "control.sock")

	// Empty group: the test must not depend on being root or on any group
	// existing. The mode is what matters, and it is set before any chown.
	ln, who, err := Listen(path, "")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()

	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != SocketMode {
		// A wider mode hands the root-equivalent control API to every local
		// user, and nothing else in the design would catch it.
		t.Fatalf("socket must be 0%o, got 0%o", SocketMode, got)
	}
	if info.Mode()&os.ModeSocket == 0 {
		t.Fatal("expected a socket")
	}
	if who == "" {
		t.Fatal("Listen must describe who can reach it, for the startup log")
	}
}

func TestListenReplacesAStaleSocket(t *testing.T) {
	path := filepath.Join(shortDir(t), "control.sock")

	first, _, err := Listen(path, "")
	if err != nil {
		t.Fatal(err)
	}
	// Close without removing, as a killed process would leave it. Binding again
	// must succeed: otherwise Bay fails to start with "address already in use",
	// which reads like a port conflict and sends you looking in the wrong place.
	first.Close()

	second, _, err := Listen(path, "")
	if err != nil {
		t.Fatalf("a leftover socket must not block startup: %v", err)
	}
	second.Close()
}

func TestListenRefusesToUnlinkANonSocket(t *testing.T) {
	path := filepath.Join(shortDir(t), "important.db")
	if err := os.WriteFile(path, []byte("real data"), 0o600); err != nil {
		t.Fatal(err)
	}

	// The path comes from a flag. Unlinking whatever it points at would turn a
	// typo into data loss.
	if _, _, err := Listen(path, ""); err == nil {
		t.Fatal("expected Listen to refuse a path that is not a socket")
	}
	if body, err := os.ReadFile(path); err != nil || string(body) != "real data" {
		t.Fatal("the file must be left untouched")
	}
}
