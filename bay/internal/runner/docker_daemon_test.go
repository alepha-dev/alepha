package runner

import (
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// daemonTestImage is small, multi-arch and has a shell and an HTTP server.
const daemonTestImage = "busybox:1.37"

/*
requireDocker connects to the real daemon, or decides what its absence means.

With BAY_REQUIRE_DOCKER=1, as CI and test-linux.sh set it, no daemon is a
FAILURE: a suite that reports `ok` because the runner tests never ran is the
exact green-while-testing-nothing state test-linux.sh exists to prevent.
Without it, on a laptop with Docker stopped, the tests skip and say why.
*/
func requireDocker(t *testing.T) *Docker {
	t.Helper()
	d, err := NewDocker("")
	if err == nil {
		return d
	}
	if os.Getenv("BAY_REQUIRE_DOCKER") == "1" {
		t.Fatalf("BAY_REQUIRE_DOCKER=1 but %v", err)
	}
	t.Skipf("no Docker daemon (%v); set BAY_REQUIRE_DOCKER=1 to make this a failure", err)
	return nil
}

/*
daemonTempDir returns a directory the daemon can bind-mount.

A bind mount names a path on the DAEMON's filesystem. When the suite runs in a
container that talks to the host's daemon (test-linux.sh), t.TempDir() lives in
the test container and the daemon would mount an empty directory of its own.
BAY_DOCKER_TESTDIR names a directory mounted at the same path on both sides.
*/
func daemonTempDir(t *testing.T) string {
	t.Helper()
	base := os.Getenv("BAY_DOCKER_TESTDIR")
	if base == "" {
		return t.TempDir()
	}
	if err := os.MkdirAll(base, 0o755); err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp(base, "run")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	return dir
}

func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestDockerDaemon(t *testing.T) {
	d := requireDocker(t)

	t.Run("a tag resolves to the registry digest it was pulled at", func(t *testing.T) {
		ref, err := d.ResolveDigest(daemonTestImage)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(ref, daemonTestImage+"@sha256:") {
			t.Fatalf("ref = %q", ref)
		}
		// The answer must be pullable as-is: that is what a lock is for.
		if err := d.EnsureImage(ref); err != nil {
			t.Fatalf("pinned ref does not resolve: %v", err)
		}
	})

	t.Run("start, serve on loopback, report, stop, park and remove", func(t *testing.T) {
		key := "bay-runner-test/t" + strconv.FormatInt(time.Now().UnixNano(), 36)
		t.Cleanup(func() { _ = d.Remove(key, true) })

		port := freePort(t)
		release := daemonTempDir(t)
		if err := os.WriteFile(filepath.Join(release, "index.html"), []byte("served from the release\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		script := "echo booting on $SERVER_PORT\nexec httpd -f -p $SERVER_PORT -h /app\n"
		if err := os.WriteFile(filepath.Join(release, "serve.sh"), []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}

		err := d.Start(Spec{
			Key:     key,
			Runtime: "sh",
			Entry:   "serve.sh",
			Env:     map[string]string{"SERVER_PORT": strconv.Itoa(port)},
			Sandbox: Container{
				Image:       daemonTestImage,
				WorkDir:     "/app",
				Mounts:      []Mount{{Source: release, Target: "/app", ReadOnly: true}},
				Port:        port,
				MemoryBytes: 64 << 20,
				PidsLimit:   64,
				StopGrace:   5 * time.Second,
			},
		})
		if err != nil {
			t.Fatal(err)
		}

		waitFor(t, "the container to run", func() bool { return d.Running(key) })
		if s := d.State(key); s != "active" {
			t.Fatalf("state = %q", s)
		}

		var body string
		waitFor(t, "the app to answer on loopback", func() bool {
			res, err := http.Get("http://127.0.0.1:" + strconv.Itoa(port) + "/index.html")
			if err != nil {
				return false
			}
			defer res.Body.Close()
			raw, _ := io.ReadAll(res.Body)
			body = string(raw)
			return res.StatusCode == 200
		})
		if body != "served from the release\n" {
			t.Fatalf("body = %q", body)
		}

		if u, ok := d.Usage(key); !ok || u.MemoryBytes == 0 || u.PID == 0 {
			t.Fatalf("usage = %+v, ok = %v", u, ok)
		}

		lines, found, err := d.Logs(key, 10)
		if err != nil || !found {
			t.Fatalf("logs: found = %v, err = %v", found, err)
		}
		var sawBoot bool
		for _, l := range lines {
			sawBoot = sawBoot || strings.Contains(l.Raw, "booting on")
		}
		if !sawBoot {
			t.Fatalf("logs = %+v", lines)
		}

		if err := d.Stop(key, 5*time.Second); err != nil {
			t.Fatal(err)
		}
		if d.Running(key) {
			t.Fatal("still running after stop")
		}
		if s := d.State(key); s != "inactive" {
			t.Fatalf("state after stop = %q", s)
		}

		// Start on an existing container is a restart, never "already exists".
		if err := d.Start(Spec{Key: key, Runtime: "sh", Entry: "serve.sh",
			Env: map[string]string{"SERVER_PORT": strconv.Itoa(port)},
			Sandbox: Container{Image: daemonTestImage, WorkDir: "/app", Port: port,
				Mounts: []Mount{{Source: release, Target: "/app", ReadOnly: true}}}}); err != nil {
			t.Fatal(err)
		}
		waitFor(t, "the restarted container to run", func() bool { return d.Running(key) })

		if err := d.Park(key, 5*time.Second); err != nil {
			t.Fatal(err)
		}
		var policy struct {
			HostConfig struct {
				RestartPolicy struct {
					Name string `json:"Name"`
				} `json:"RestartPolicy"`
			} `json:"HostConfig"`
		}
		if err := d.api.do("GET", "/containers/"+unitName(key)+"/json", nil, nil, &policy, dockerCallTimeout); err != nil {
			t.Fatal(err)
		}
		if policy.HostConfig.RestartPolicy.Name != "no" {
			t.Fatalf("restart policy after park = %q", policy.HostConfig.RestartPolicy.Name)
		}

		if err := d.Remove(key, true); err != nil {
			t.Fatal(err)
		}
		if _, found, _ := d.Logs(key, 1); found {
			t.Fatal("logs still found after remove")
		}
	})
}
