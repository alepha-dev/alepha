package main

import (
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"github.com/alepha-dev/bay/internal/runner"
)

/*
check is one line of `bay doctor`.

Every check is a sentence an operator can act on, not a status code: what was
looked at, what was found, and what to do when it is wrong.
*/
type check struct {
	Name   string
	OK     bool
	Detail string
}

// minFreeDisk is the floor below which a deploy is likely to fail halfway:
// a runtime image, a release and its unpacked copy, plus a backup snapshot.
const minFreeDisk = 2 << 30

/*
cmdDoctor checks that this host can run Bay, one line per check, and exits
non-zero when any of them fails.

It is a client command that needs no running Bay, on purpose: it is what to
run BEFORE the first `bay serve`, and again when a deploy fails for a reason
the deploy itself cannot name.
*/
func cmdDoctor(args []string) error {
	root := "/opt/bay/data"
	if err := checkFlags(args, map[string]bool{},
		map[string]bool{"--root": true, "--control-socket": true}); err != nil {
		return err
	}
	for i := 0; i < len(args)-1; i++ {
		if args[i] == "--root" {
			root = args[i+1]
		}
	}
	checks := runDoctor(root)
	failed := printChecks(os.Stdout, checks)
	if failed > 0 {
		return fmt.Errorf("%d check(s) failed", failed)
	}
	return nil
}

func runDoctor(root string) []check {
	var checks []check
	docker, err := runner.NewDocker("")
	checks = append(checks, dockerReachable(err))
	if err == nil {
		info, err := docker.Info()
		checks = append(checks, dockerVersion(info, err), cgroupV2(info, err))
	}
	checks = append(checks, composePlugin())
	checks = append(checks, portFree(80), portFree(443))
	checks = append(checks, diskFree(root))
	return checks
}

// printChecks writes one line per check and returns how many failed.
func printChecks(w io.Writer, checks []check) int {
	failed := 0
	for _, c := range checks {
		mark := "ok  "
		if !c.OK {
			mark = "FAIL"
			failed++
		}
		fmt.Fprintf(w, "%s  %-18s %s\n", mark, c.Name, c.Detail)
	}
	return failed
}

/*
dockerReachable turns a failed connection into the fix.

A permission error is the common case on a fresh host: Docker is installed and
running, and the user running Bay is simply not allowed on its socket.
*/
func dockerReachable(err error) check {
	c := check{Name: "docker"}
	switch {
	case err == nil:
		c.OK, c.Detail = true, "the daemon answers"
	case errors.Is(err, syscall.EACCES) || strings.Contains(err.Error(), "permission denied"):
		c.Detail = "not allowed on the Docker socket: run Bay as root, or add this user to the docker group"
	default:
		c.Detail = "not reachable (" + err.Error() + "): install Docker, or start it with `systemctl enable --now docker`"
	}
	return c
}

func dockerVersion(info runner.DaemonInfo, err error) check {
	c := check{Name: "docker version"}
	if err != nil {
		c.Detail = "the daemon did not say: " + err.Error()
		return c
	}
	if !apiAtLeast(info.APIVersion, runner.MinDockerAPI) {
		c.Detail = fmt.Sprintf("Docker %s speaks API %s, Bay needs %s or newer (Docker 25+): upgrade Docker",
			info.Version, info.APIVersion, runner.MinDockerAPI)
		return c
	}
	c.OK, c.Detail = true, fmt.Sprintf("Docker %s, API %s", info.Version, info.APIVersion)
	return c
}

// apiAtLeast compares two "major.minor" Engine API versions.
func apiAtLeast(have, want string) bool {
	parse := func(v string) (int, int) {
		major, minor, _ := strings.Cut(v, ".")
		a, _ := strconv.Atoi(major)
		b, _ := strconv.Atoi(minor)
		return a, b
	}
	hm, hn := parse(have)
	wm, wn := parse(want)
	return hm > wm || (hm == wm && hn >= wn)
}

/*
cgroupV2 checks the daemon runs on cgroup v2, where a container's memory and
CPU ceilings and its usage figures are what Bay reports. On v1 the limits
still apply, but the memory figure counts differently and Docker is dropping
support for it.
*/
func cgroupV2(info runner.DaemonInfo, err error) check {
	c := check{Name: "cgroup v2"}
	if err != nil {
		c.Detail = "the daemon did not say"
		return c
	}
	if info.CgroupVersion != "2" {
		c.Detail = "the daemon runs on cgroup v" + info.CgroupVersion + ": boot the host with cgroup v2 (the default on every current distribution)"
		return c
	}
	c.OK, c.Detail = true, "the daemon runs on cgroup v2"
	return c
}

/*
composePlugin checks for `docker compose`, which stacks run on. Absent today
is not yet fatal for a single app, but a host set up without it fails at its
first stack, so the check says so now.
*/
func composePlugin() check {
	c := check{Name: "compose plugin"}
	out, err := exec.Command("docker", "compose", "version", "--short").Output()
	if err != nil {
		c.Detail = "`docker compose` is missing: install the docker-compose-plugin package"
		return c
	}
	c.OK, c.Detail = true, "docker compose "+strings.TrimSpace(string(out))
	return c
}

/*
portFree checks Bay can bind a public port.

A port already held is fine when Bay itself holds it: re-running the doctor on
a live host must not fail on the proxy it is checking.
*/
func portFree(port int) check {
	c := check{Name: "port " + strconv.Itoa(port)}
	ln, err := net.Listen("tcp", ":"+strconv.Itoa(port))
	if err == nil {
		ln.Close()
		c.OK, c.Detail = true, "free"
		return c
	}
	if controlSocketPath() != "" {
		c.OK, c.Detail = true, "held, and a Bay answers on this host"
		return c
	}
	if errors.Is(err, syscall.EACCES) {
		c.Detail = "binding it needs root, which `bay serve` runs as: re-run the doctor as root"
		return c
	}
	c.Detail = "already in use by another program: stop it, Bay is the reverse proxy on this host"
	return c
}

// diskFree checks the data root's filesystem has room for a deploy.
func diskFree(root string) check {
	c := check{Name: "disk"}
	path := root
	// The root may not exist yet before the first `bay serve`; its parent is
	// on the same filesystem in every layout INSTALL.md describes.
	for {
		if _, err := os.Stat(path); err == nil || path == "/" || path == "." {
			break
		}
		path = filepath.Dir(path)
	}
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		c.Detail = "cannot read free space at " + path + ": " + err.Error()
		return c
	}
	free := int64(st.Bavail) * int64(st.Bsize)
	c.Detail = fmt.Sprintf("%.1f GiB free at %s", float64(free)/(1<<30), path)
	c.OK = free >= minFreeDisk
	if !c.OK {
		c.Detail += fmt.Sprintf(", under the %d GiB a deploy needs", minFreeDisk>>30)
	}
	return c
}
