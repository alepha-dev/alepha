package main

import (
	"bytes"
	"errors"
	"strings"
	"testing"

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
