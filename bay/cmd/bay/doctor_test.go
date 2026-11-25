package main

import (
	"bytes"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/connector"
	"github.com/alepha-dev/bay/internal/runner"
)

func TestDoctor(t *testing.T) {
	t.Run("compares Engine API versions numerically", func(t *testing.T) {
		cases := map[[2]string]bool{
			{"1.44", "1.44"}: true,
			{"1.55", "1.44"}: true,
			{"1.9", "1.44"}:  false,
			{"1.43", "1.44"}: false,
			{"2.0", "1.44"}:  true,
		}
		for in, want := range cases {
			if got := apiAtLeast(in[0], in[1]); got != want {
				t.Errorf("apiAtLeast(%s, %s) = %v", in[0], in[1], got)
			}
		}
	})

	t.Run("an old Docker fails and names the upgrade", func(t *testing.T) {
		c := dockerVersion(runner.DaemonInfo{Version: "24.0.9", APIVersion: "1.43"}, nil)
		if c.OK || !strings.Contains(c.Detail, "upgrade Docker") {
			t.Fatalf("check = %+v", c)
		}
		if c := dockerVersion(runner.DaemonInfo{Version: "29.7.2", APIVersion: "1.55"}, nil); !c.OK {
			t.Fatalf("check = %+v", c)
		}
	})

	t.Run("cgroup v1 fails", func(t *testing.T) {
		if c := cgroupV2(runner.DaemonInfo{CgroupVersion: "1"}, nil); c.OK {
			t.Fatalf("check = %+v", c)
		}
		if c := cgroupV2(runner.DaemonInfo{CgroupVersion: "2"}, nil); !c.OK {
			t.Fatalf("check = %+v", c)
		}
	})

	t.Run("a refused socket says which group to join", func(t *testing.T) {
		c := dockerReachable(errors.New("dial unix /var/run/docker.sock: connect: permission denied"))
		if c.OK || !strings.Contains(c.Detail, "docker group") {
			t.Fatalf("check = %+v", c)
		}
		c = dockerReachable(errors.New("dial unix /var/run/docker.sock: connect: no such file or directory"))
		if c.OK || !strings.Contains(c.Detail, "install Docker") {
			t.Fatalf("check = %+v", c)
		}
	})

	t.Run("prints one line per check and counts the failures", func(t *testing.T) {
		var out bytes.Buffer
		failed := printChecks(&out, []check{
			{Name: "docker", OK: true, Detail: "the daemon answers"},
			{Name: "port 80", OK: false, Detail: "already in use"},
		})
		if failed != 1 {
			t.Fatalf("failed = %d", failed)
		}
		lines := strings.Split(strings.TrimSpace(out.String()), "\n")
		if len(lines) != 2 || !strings.HasPrefix(lines[0], "ok") || !strings.HasPrefix(lines[1], "FAIL") {
			t.Fatalf("output = %q", out.String())
		}
	})

	t.Run("free disk is read from the nearest existing parent", func(t *testing.T) {
		c := diskFree(t.TempDir() + "/not/yet/created")
		if !strings.Contains(c.Detail, "GiB free") {
			t.Fatalf("check = %+v", c)
		}
	})
}

// heldPort holds a port as any other program would, and returns it.
func heldPort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	return ln.Addr().(*net.TCPAddr).Port
}

// controlSocket points the client at a socket in a directory short enough for
// sun_path, which os.MkdirTemp gives and t.TempDir, on a long test name, does not.
func controlSocket(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "bay")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	path := filepath.Join(dir, "control.sock")
	t.Setenv("BAY_SOCKET", path)
	return path
}

func serveSocket(t *testing.T, path string, handler http.Handler) {
	t.Helper()
	ln, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: handler}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close() })
}

// Being told where a socket is says nothing about what holds the port: the path
// is whatever was typed, and it used to be enough to pass ports 80 and 443 on a
// host where nginx had them and no Bay had ever run.
func TestPortHeldByAnotherProgram(t *testing.T) {
	t.Run("fails when the socket does not exist", func(t *testing.T) {
		controlSocket(t)

		if c := portFree(heldPort(t)); c.OK {
			t.Fatalf("check = %+v", c)
		}
	})

	t.Run("fails when a stale socket file is left behind", func(t *testing.T) {
		path := controlSocket(t)
		ln, err := net.Listen("unix", path)
		if err != nil {
			t.Fatal(err)
		}
		ln.(*net.UnixListener).SetUnlinkOnClose(false)
		ln.Close()

		if c := portFree(heldPort(t)); c.OK {
			t.Fatalf("check = %+v", c)
		}
	})

	t.Run("fails when what answers is not a Bay", func(t *testing.T) {
		serveSocket(t, controlSocket(t), http.NotFoundHandler())

		if c := portFree(heldPort(t)); c.OK {
			t.Fatalf("check = %+v", c)
		}
	})
}

func TestPortHeldByBayItself(t *testing.T) {
	f := newDeployFixture(t)
	serveSocket(t, controlSocket(t), f.server.controlMux())

	c := portFree(heldPort(t))

	if !c.OK || !strings.Contains(c.Detail, "a Bay answers") {
		t.Fatalf("check = %+v", c)
	}
}

func TestDoctorToolChecks(t *testing.T) {
	t.Run("lists the tools with their sign-ins, warns on what is missing or signed out, and on a signed-in lore", func(t *testing.T) {
		yes, no := true, false
		checks := toolChecks([]connector.InventoryTool{
			{Name: "claude", Kind: "agent", Found: true, Version: "2.1.7", SignedIn: &yes, Account: "ops@example.com"},
			{Name: "gemini", Kind: "agent"},
			{Name: "gh", Kind: "tool", Found: true, Error: "gh --version exited with status 1"},
			{Name: "cf", Kind: "tool", Found: true, Version: "0.15.0", SignedIn: &no},
			{Name: "git", Kind: "tool", Found: true, Version: "2.43.0"},
			{Name: "lore", Kind: "tool", Found: true, Version: "0.38.0", SignedIn: &yes},
			{Name: "playwright-cli", Kind: "tool", Found: true, Version: "0.1.1"},
		}, "bay-agent")
		var lines []string
		for _, c := range checks {
			lines = append(lines, fmt.Sprintf("%s ok=%v warn=%v %s", c.Name, c.OK, c.Warn, c.Detail))
		}
		got := strings.Join(lines, "\n") + "\n"
		for _, want := range []string{
			"claude ok=true warn=false 2.1.7 (agent CLI), signed in as ops@example.com",
			"gemini ok=false warn=true not installed for bay-agent",
			"gh ok=false warn=true found, but gh --version exited with status 1",
			"cf ok=false warn=true 0.15.0, signed out: sudo -iu bay-agent cf auth login --no-browser",
			"git ok=true warn=false 2.43.0\n",
			"lore ok=false warn=true 0.38.0, the jobs user's lore CLI is signed in: a job would reach past its key's pins (sudo -iu bay-agent lore logout)",
			"playwright-cli ok=true warn=false 0.1.1, for a build job's look at its screens; it needs a browser too",
		} {
			if !strings.Contains(got, want) {
				t.Fatalf("doctor said:\n%s\nwant a line %q", got, want)
			}
		}
		if strings.Contains(got, "cannot run agent jobs") {
			t.Fatal("a host with an agent CLI was said to have none")
		}
	})

	t.Run("says playwright-cli is optional when it is missing", func(t *testing.T) {
		checks := toolChecks([]connector.InventoryTool{{Name: "claude", Kind: "agent", Found: true, Version: "2"}, {Name: "playwright-cli", Kind: "tool"}}, "bay-agent")
		last := checks[len(checks)-1]
		if last.Name != "playwright-cli" || !last.Warn || !strings.Contains(last.Detail, "optional, build jobs make no visual check without it") {
			t.Fatalf("checks = %+v", checks)
		}
	})

	t.Run("says plainly when no agent CLI answers", func(t *testing.T) {
		checks := toolChecks([]connector.InventoryTool{{Name: "claude", Kind: "agent"}, {Name: "gemini", Kind: "agent"}}, "bay-agent")
		var found bool
		for _, c := range checks {
			if c.Name == "agent jobs" && c.Warn && strings.Contains(c.Detail, "this host cannot run agent jobs") {
				found = true
			}
		}
		if !found {
			t.Fatalf("checks = %+v", checks)
		}
	})
}

func TestDoctorRunsApps(t *testing.T) {
	root := t.TempDir()
	if runsApps(root) {
		t.Fatal("a host with no state runs apps")
	}
	if err := os.WriteFile(filepath.Join(root, "state.json"), []byte(`{"version":1,"apps":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if runsApps(root) {
		t.Fatal("a host with no app runs apps")
	}
	if err := os.WriteFile(filepath.Join(root, "state.json"), []byte(`{"version":1,"apps":[{"name":"web"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if !runsApps(root) {
		t.Fatal("a host with an app runs none")
	}
}
