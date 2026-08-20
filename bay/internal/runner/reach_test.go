package runner

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCanTraverseChecksOneClassOnly(t *testing.T) {
	cases := []struct {
		name     string
		mode     os.FileMode
		ownerUID uint32
		ownerGID uint32
		uid      uint32
		gids     []uint32
		want     bool
	}{
		{"0700 blocks a stranger", 0o700, 0, 0, 999, []uint32{999}, false},
		{"0711 lets a stranger through", 0o711, 0, 0, 999, []uint32{999}, true},
		{"0755 lets a stranger through", 0o755, 0, 0, 999, []uint32{999}, true},
		{"0700 lets its owner through", 0o700, 999, 999, 999, []uint32{999}, true},
		{"0077 denies its owner", 0o077, 999, 999, 999, []uint32{999}, false},
		{"0710 lets the group through", 0o710, 0, 50, 999, []uint32{999, 50}, true},
		{"0700 blocks the group", 0o700, 0, 50, 999, []uint32{999, 50}, false},
		{"root ignores the bits", 0o000, 999, 999, 0, []uint32{0}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := canTraverse(tc.mode, tc.ownerUID, tc.ownerGID, tc.uid, tc.gids)
			if got != tc.want {
				t.Fatalf("canTraverse(%v, owner %d:%d, as %d) = %v, want %v",
					tc.mode, tc.ownerUID, tc.ownerGID, tc.uid, got, tc.want)
			}
		})
	}
}

func TestBlockedAncestorNamesTheDirectoryThatBlocks(t *testing.T) {
	if os.Getuid() == 0 {
		t.Skip("root traverses whatever the mode says, so nothing can block")
	}
	base := t.TempDir()
	closed := filepath.Join(base, "data")
	work := filepath.Join(closed, "apps", "demo", "current")
	if err := os.MkdirAll(work, 0o755); err != nil {
		t.Fatal(err)
	}

	uid := uint32(os.Getuid())
	gids := []uint32{uint32(os.Getgid())}

	if blocked := blockedAncestor(work, uid, gids); blocked != nil {
		t.Fatalf("nothing should block yet, got %s (%v)", blocked.path, blocked.mode)
	}

	// The exact shape the installer produced: the app's own subtree is fine and
	// the directory holding it is not.
	if err := os.Chmod(closed, 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(closed, 0o755) })

	blocked := blockedAncestor(work, uid, gids)
	if blocked == nil {
		t.Fatal("expected the closed directory to block the walk")
	}
	if blocked.path != closed {
		t.Fatalf("blamed %s, want %s", blocked.path, closed)
	}
}

func TestBlockedAncestorToleratesAPathThatDoesNotExist(t *testing.T) {
	// A working directory Bay has not created yet is not a permission problem,
	// and a diagnostic must never be the reason a start fails.
	missing := filepath.Join(t.TempDir(), "not", "created", "yet")
	if blocked := blockedAncestor(missing, uint32(os.Getuid()), []uint32{uint32(os.Getgid())}); blocked != nil {
		t.Fatalf("expected no verdict, got %s", blocked.path)
	}
}

func TestAssertReachableRefusesAHomeDirectoryRoot(t *testing.T) {
	// `./bay-data` under the deploying user's home is the documented default,
	// and ProtectHome=yes makes it invisible to every unit whatever its mode.
	err := AssertReachable("bay-demo-production", "/home/ubuntu/bay-data/apps/demo/production/current")
	if err == nil {
		t.Fatal("expected a home-directory root to be refused")
	}
	if !strings.Contains(err.Error(), "ProtectHome") {
		t.Fatalf("error should name the directive that hides it, got: %v", err)
	}
}

func TestProtectedHomeOnlyMatchesWholeComponents(t *testing.T) {
	if got := protectedHome("/opt/bay/data/apps/demo/production/current"); got != "" {
		t.Fatalf("/opt is not protected, got %q", got)
	}
	if got := protectedHome("/home/ubuntu/bay-data"); got != "/home" {
		t.Fatalf("got %q, want /home", got)
	}
	if got := protectedHome("/homework/bay-data"); got != "" {
		t.Fatalf("/homework is not /home, got %q", got)
	}
}
