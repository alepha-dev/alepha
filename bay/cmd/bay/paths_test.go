package main

import (
	"net"
	"os"
	"path/filepath"
	"testing"
)

// installerLayout points the installer's paths at temp ones and runs the test
// from an empty directory, so ./bay-data is absent unless the test makes it.
func installerLayout(t *testing.T) (root, sock string) {
	t.Helper()
	t.Chdir(t.TempDir())
	t.Setenv("BAY_ROOT", "")
	t.Setenv("BAY_SOCKET", "")
	root = servedRoot(t)
	dir, err := os.MkdirTemp("", "bay")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	sock = filepath.Join(dir, "control.sock")
	prevRoot, prevSock := installerRoot, installerSocket
	installerRoot, installerSocket = root, sock
	t.Cleanup(func() { installerRoot, installerSocket = prevRoot, prevSock })
	return root, sock
}

func listenSocket(t *testing.T, path string) {
	t.Helper()
	ln, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
}

func TestConnectorRootFallsBackToTheInstallersRoot(t *testing.T) {
	root, _ := installerLayout(t)
	got, err := connectorRoot(nil)
	if err != nil || got != root {
		t.Fatalf("connectorRoot on an installed host = %q, %v; want %q", got, err, root)
	}
}

func TestConnectorRootPrefersARealCheckoutRoot(t *testing.T) {
	installerLayout(t)
	if err := os.MkdirAll(defaultRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(defaultRoot, "state.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := connectorRoot(nil)
	if err != nil || got != defaultRoot {
		t.Fatalf("connectorRoot in a checkout = %q, %v; want %q", got, err, defaultRoot)
	}
}

func TestConnectorRootIgnoresAnEmptyInstallerDirectory(t *testing.T) {
	installerLayout(t)
	installerRoot = t.TempDir() // the directory exists, no state.json
	if _, err := connectorRoot(nil); err == nil {
		t.Fatal("an installer directory with no state.json must not count as a root")
	}
}

func TestConnectorRootFlagAndEnvStillWin(t *testing.T) {
	installerLayout(t)
	flag := servedRoot(t)
	if got, _ := connectorRoot([]string{"--root", flag}); got != flag {
		t.Fatalf("--root = %q, want %q", got, flag)
	}
	env := servedRoot(t)
	t.Setenv("BAY_ROOT", env)
	if got, _ := connectorRoot(nil); got != env {
		t.Fatalf("$BAY_ROOT = %q, want %q", got, env)
	}
}

func TestControlSocketFallsBackToTheInstallersSocket(t *testing.T) {
	_, sock := installerLayout(t)
	if got := controlSocketPath(); got != "" {
		t.Fatalf("no socket listening yet, got %q", got)
	}
	listenSocket(t, sock)
	if got := controlSocketPath(); got != sock {
		t.Fatalf("controlSocketPath = %q, want the installer's %q", got, sock)
	}
}

func TestControlSocketIgnoresAPlainFile(t *testing.T) {
	_, sock := installerLayout(t)
	if err := os.WriteFile(sock, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if got := controlSocketPath(); got != "" {
		t.Fatalf("a plain file is not a socket, got %q", got)
	}
}

func TestDoctorResolvesTheSameRoot(t *testing.T) {
	root, _ := installerLayout(t)
	if got, _ := resolveRoot(nil, installerRoot); got != root {
		t.Fatalf("doctor root = %q, want %q", got, root)
	}
	installerRoot = "/nonexistent/bay/data"
	if got, _ := resolveRoot(nil, installerRoot); got != installerRoot {
		t.Fatalf("doctor before the first serve = %q, want the installer's root", got)
	}
}
