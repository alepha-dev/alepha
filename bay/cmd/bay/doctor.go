package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/alepha-dev/bay/internal/connector"
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
	// Warn marks a check that is not OK but does not fail doctor: a risk the
	// operator should know about, on a host that still works.
	Warn bool
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
	if err := checkFlags(args, map[string]bool{"--probe-keys": true},
		map[string]bool{"--root": true, "--control-socket": true}); err != nil {
		return err
	}
	// The same resolver as every client command (#Q3156), falling back on the
	// installer's root: doctor runs before the first `bay serve`, when no
	// state.json exists anywhere yet.
	root, _ := resolveRoot(args, installerRoot)
	checks := runDoctor(root, hasFlag(args, "--probe-keys"))
	failed := printChecks(os.Stdout, checks)
	if failed > 0 {
		return fmt.Errorf("%d check(s) failed", failed)
	}
	return nil
}

func runDoctor(root string, probeKeys bool) []check {
	var checks []check
	docker, err := runner.NewDocker("")
	if err != nil && !runsApps(root) {
		// Docker is what deploys need (#Q4221). A host that runs no app, one
		// that only runs agent jobs or reports its gauge to Lore, does
		// without it: said, not failed.
		c := dockerReachable(err)
		c.Warn = true
		c.Detail += "; needed to deploy apps only, and this host runs none"
		checks = append(checks, c)
	} else {
		checks = append(checks, dockerReachable(err))
		if err == nil {
			info, err := docker.Info()
			checks = append(checks, dockerVersion(info, err), cgroupV2(info, err))
		}
		checks = append(checks, composePlugin())
	}
	checks = append(checks, portFree(80), portFree(443))
	checks = append(checks, diskFree(root))
	if c, has := handoffCheck(showUnit("bay.service")); has {
		checks = append(checks, c)
	}
	checks = append(checks, storageChecks(root, probeKeys)...)
	checks = append(checks, jobChecks(root)...)
	return checks
}

/*
jobChecks lists what the jobs user has (#Q4220), the same list the inventory
reports: each agent CLI, then git, gh, cf, lore and playwright-cli. None of it is required of a
host that only deploys, so a missing tool is a warning; no agent CLI at all
says plainly that the host cannot run agent jobs. Nothing is printed when
no jobs user is configured. Whether gh and lore are signed in is not
checked, and the last line says so.
*/
func jobChecks(root string) []check {
	cfg, err := loadJobsConfig(root)
	if err != nil || cfg.User == "" {
		return nil
	}
	r := newProcessRunner(root)
	u, err := r.jobsUser()
	if err != nil {
		return []check{{Name: "jobs user", Warn: true, Detail: err.Error()}}
	}
	return toolChecks(r.tools(context.Background(), u), u.Username)
}

// toolChecks turns the jobs user's tools into doctor lines.
func toolChecks(tools []connector.InventoryTool, username string) []check {
	var checks []check
	agents := 0
	for _, t := range tools {
		c := check{Name: t.Name, OK: t.Found && t.Error == ""}
		switch {
		case c.OK:
			c.Detail = t.Version
			if t.Kind == "agent" {
				agents++
				c.Detail += " (agent CLI)"
			}
			// Its sign-in (#Q4256): lore must not be signed in, the others
			// should be.
			switch {
			case t.Name == "lore" && t.SignedIn != nil && *t.SignedIn:
				c.OK, c.Warn = false, true
				c.Detail += ", " + loreSignedInWarning(t.Account, username)
			case t.Name == "lore":
				c.Detail += ", not signed in, as it should be"
			case t.Name == "playwright-cli":
				// No sign-in (#Q4346): it drives a browser, and Bay does not
				// check that one is installed.
				c.Detail += ", for a build job's look at its screens; it needs a browser too"
			case t.SignedIn != nil && *t.SignedIn && t.Account != "":
				c.Detail += ", signed in as " + t.Account
			case t.SignedIn != nil && *t.SignedIn:
				c.Detail += ", signed in"
			case t.SignedIn != nil:
				c.OK, c.Warn = false, true
				c.Detail += ", signed out: " + signInCommand(t.Name, username)
			case t.Name != "git":
				c.Detail += ", sign-in unknown"
			}
		case t.Found:
			c.Warn = true
			c.Detail = "found, but " + t.Error
		case t.Name == "playwright-cli":
			// Optional (#Q4346): build jobs then make no visual check.
			c.Warn = true
			c.Detail = "not installed for " + username + ": optional, build jobs make no visual check without it"
		default:
			c.Warn = true
			c.Detail = "not installed for " + username
		}
		checks = append(checks, c)
	}
	if agents == 0 {
		checks = append(checks, check{Name: "agent jobs", Warn: true,
			Detail: fmt.Sprintf("no supported agent CLI (%s) answers for %s: this host cannot run agent jobs", strings.Join(adapterNames(), ", "), username)})
	}
	return checks
}

/*
runsApps says whether this host runs an app or a stack, read straight from
state.json as `storageChecks` reads it (opening the store may write it). A
host with no state yet runs none. An unreadable state counts as running
apps: the Docker checks then stay failures, the safe side.
*/
func runsApps(root string) bool {
	raw, err := os.ReadFile(filepath.Join(root, "state.json"))
	if errors.Is(err, os.ErrNotExist) {
		return false
	}
	if err != nil {
		return true
	}
	var st struct {
		Apps   []json.RawMessage `json:"apps"`
		Stacks []json.RawMessage `json:"stacks"`
	}
	if json.Unmarshal(raw, &st) != nil {
		return true
	}
	return len(st.Apps)+len(st.Stacks) > 0
}

// printChecks writes one line per check and returns how many failed;
// warnings are printed, not counted.
func printChecks(w io.Writer, checks []check) int {
	failed := 0
	for _, c := range checks {
		mark := "ok  "
		switch {
		case c.OK:
		case c.Warn:
			mark = "WARN"
		default:
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
	if bayAnswers() {
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

/*
bayAnswers asks the control API whether a Bay is there.

A path says nothing: --control-socket and $BAY_SOCKET are whatever was typed, and
a socket file outlives the Bay that bound it. `/settings` is the cheapest route,
and an answer from it is what tells Bay from anything else on a socket.
*/
func bayAnswers() bool {
	sock := controlSocketPath()
	if sock == "" {
		return false
	}
	client := &http.Client{Timeout: 3 * time.Second, Transport: controlTransport(sock)}
	res, err := client.Get(controlHost + "/settings")
	if err != nil {
		return false
	}
	defer res.Body.Close()
	return res.StatusCode == http.StatusOK
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

/*
handoffCheck reads `systemctl show bay.service` and warns when the unit lacks
what a socket handoff needs. No line at all on a host with no bay unit (or no
systemd): there is nothing to fix there yet.

A warning, never a failure: Bay runs without the drop-in. What is lost is the
restart that costs nothing, and the upgrade from Lore, which is only sent to a
Bay that can hand over.
*/
func handoffCheck(show string, err error) (check, bool) {
	// An unknown unit still answers, with an empty PIDFile and no ExecReload
	// line worth reading, so "is there a unit" is asked of its file.
	if err != nil || !unitExists() {
		return check{}, false
	}
	c := check{Name: "handoff"}
	if dropInInEffect(show, "/run/bay/bay.pid") {
		c.OK, c.Detail = true, "systemd follows a handoff: a reload or an upgrade of Bay refuses no connection"
		return c, true
	}
	c.Warn = true
	c.Detail = "the bay unit lacks the handoff drop-in (" + handoffDropIn + "), so an upgrade restarts Bay and cannot be started from Lore: re-run install.sh with BAY_UPDATE_UNIT=yes"
	return c, true
}

// unitExists says whether systemd knows a bay service on this host.
var unitExists = func() bool {
	out, err := exec.Command("systemctl", "show", "bay.service", "-p", "LoadState", "--value").Output()
	return err == nil && strings.TrimSpace(string(out)) == "loaded"
}
