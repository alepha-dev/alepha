package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/alepha-dev/bay/internal/connector"
)

/*
The `upgrade` verb: Lore names a released version, and this Bay replaces its
own binary with it and hands over to it (#Q3737).

It is the most powerful verb of the vocabulary, since the binary it replaces
runs as root, so everything it could be told is taken away from the wire:

  - One field, a strict x.y.z. Where the binary comes from is a constant of
    this file (the repository install.sh uses), never the frame or the
    environment. There is no URL, no path, no checksum to pass.
  - No way back. A version older than this Bay's is refused, always: a Lore
    that was taken over could otherwise put a host back on a release with a
    known flaw. Going back is install.sh, run on the machine.
  - Held to the deploy switch, like every verb that changes what runs here.

What is trusted is what install.sh trusts: the checksum is read from the same
release as the binary, so it catches a corrupt download, not a release that
was tampered with.
*/

// releaseBase is where released binaries are fetched from. A variable for one
// reason: a test serves a release of its own. Nothing else assigns it.
var releaseBase = "https://github.com/alepha-dev/alepha/releases/download"

// upgradeFetchTimeout bounds the two downloads; maxBinaryBytes bounds the
// binary, several times a real one, so a wrong answer cannot fill the disk.
const (
	upgradeFetchTimeout = 3 * time.Minute
	maxBinaryBytes      = 512 << 20
)

// self is the binary this process was started from, twice: as tableflip will
// start the successor (os.Args[0]) and as the kernel knows it. Variables, so
// a test can stand in a file of its own.
var (
	selfArg0       = func() string { return os.Args[0] }
	selfExecutable = os.Executable
)

var strictVersion = regexp.MustCompile(`^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$`)

// parseVersion reads a strict x.y.z: no prefix, no pre-release, no build.
func parseVersion(v string) ([3]int, bool) {
	m := strictVersion.FindStringSubmatch(v)
	if m == nil {
		return [3]int{}, false
	}
	var out [3]int
	for i := range out {
		out[i], _ = strconv.Atoi(m[i+1])
	}
	return out, true
}

// compareVersions is negative when a is older than b.
func compareVersions(a, b [3]int) int {
	for i := range a {
		if a[i] != b[i] {
			return a[i] - b[i]
		}
	}
	return 0
}

/*
byHandCommand is the one line that upgrades this host from a shell, said to
whoever asked for an upgrade this Bay cannot take. BAY_UPDATE_UNIT=yes makes
that one run install the handoff drop-in too, so the next upgrade is a click.

`version` has passed parseVersion by the time it is written here: a person is
about to paste this into a root shell.
*/
func byHandCommand(version string) string {
	return "curl -sSL https://alepha.dev/bay/install.sh | sudo BAY_VERSION=" + version + " BAY_UPDATE_UNIT=yes sh"
}

/*
upgrade runs the verb, under the machine mutex. See the file comment for what
it refuses; the order below is the order of the refusals, cheapest first, and
nothing touches the network before all of them have passed.

It returns `done` only once the new version serves: handOver waits for the
successor to say it is ready, and the ack is sent by this process, which still
holds the connection. `serve` then sees the handoff and leaves on its own, so
there is no exit in here.
*/
func (a *actions) upgrade(ctx context.Context, cmd connector.Command, send func(connector.Ack) error) (status, step, reason string) {
	s := a.s
	if !a.latestWelcome().DeployAllowed {
		return "failed", "", "this host does not accept deploys, and so no upgrade of Bay either: its owner has not allowed them, and the welcome frame said so"
	}
	want, ok := parseVersion(cmd.Version)
	if !ok {
		return "failed", "", fmt.Sprintf("%q is not a version: an upgrade names a release as x.y.z, and nothing else", cmd.Version)
	}
	have, ok := parseVersion(version)
	if !ok {
		return "failed", "", "this Bay runs a build with no release version (" + version + "), so it cannot tell an upgrade from a downgrade: install a release with install.sh on the machine"
	}
	switch cmp := compareVersions(want, have); {
	case cmp == 0:
		return "done", "", "this Bay already runs " + version + ": nothing to do"
	case cmp < 0:
		return "failed", "", "this Bay runs " + version + " and does not go back to " + cmd.Version + " from Lore: an older version is installed on the machine, with install.sh and BAY_VERSION=" + cmd.Version
	}
	switch s.upgradeMode {
	case upgradeHandoff:
	case upgradeRestart:
		return "failed", "", "this Bay's systemd unit lacks the handoff drop-in, so it cannot hand over to a new version. Upgrade it on the machine, once, and the next upgrade can be started from Lore: " + byHandCommand(cmd.Version)
	default:
		return "failed", "", "this Bay does not run under systemd, so it cannot hand over to a new version. Upgrade it on the machine: " + byHandCommand(cmd.Version)
	}
	if err := s.handoffBlocked(); err != nil {
		return "failed", "", err.Error()
	}
	exe, err := resolveSelf()
	if err != nil {
		return "failed", "", err.Error()
	}

	progress := func(step string) { _ = send(connector.NewAck(cmd.ID, "running", step, "")) }
	asset := "bay-linux-" + runtime.GOARCH
	base := releaseBase + "/" + cmd.Version

	// Next to the executable, so the rename below never crosses a filesystem.
	fresh := exe + ".new"
	defer os.Remove(fresh)
	step = "downloading"
	progress(step)
	fetchCtx, cancel := context.WithTimeout(ctx, upgradeFetchTimeout)
	defer cancel()
	sums, err := fetchBytes(fetchCtx, base+"/SHA256SUMS", 1<<20)
	if err != nil {
		return "failed", step, "could not fetch the checksums of " + cmd.Version + ": " + err.Error()
	}
	got, err := fetchFile(fetchCtx, base+"/"+asset, fresh, maxBinaryBytes)
	if err != nil {
		return "failed", step, "could not fetch " + asset + " of " + cmd.Version + ": " + err.Error()
	}

	step = "verifying"
	progress(step)
	expected := checksumFor(string(sums), asset)
	if expected == "" {
		return "failed", step, "the release " + cmd.Version + " lists no checksum for " + asset
	}
	if got != expected {
		return "failed", step, fmt.Sprintf("checksum mismatch for %s of %s: got %s…, expected %s…", asset, cmd.Version, got[:12], expected[:12])
	}
	if err := os.Chmod(fresh, 0o755); err != nil {
		return "failed", step, err.Error()
	}
	// The binary says what it is before it is trusted with the host: a
	// release that carried another version's build stops here.
	said, err := exec.CommandContext(fetchCtx, fresh, "version").Output()
	if err != nil {
		return "failed", step, "the downloaded binary does not run: " + err.Error()
	}
	if strings.TrimSpace(string(said)) != cmd.Version {
		return "failed", step, fmt.Sprintf("the downloaded binary says it is %q, not %s", strings.TrimSpace(string(said)), cmd.Version)
	}

	step = "installing"
	progress(step)
	previous := filepath.Join(filepath.Dir(exe), "bay.previous")
	if err := copyFile(exe, previous); err != nil {
		return "failed", step, "could not keep the current binary as " + previous + ": " + err.Error()
	}
	// A rename, never a write into the running binary: atomic, and it works
	// while the old inode executes.
	if err := os.Rename(fresh, exe); err != nil {
		return "failed", step, "could not install the new binary: " + err.Error()
	}

	step = "handing over"
	progress(step)
	s.log.Info("upgrading bay", "from", version, "to", cmd.Version)
	if err := s.handOver(); err != nil {
		// The new binary cannot serve, or could not be started. The old one
		// goes back where systemd will look for it, and this process, which
		// never stopped serving, carries on.
		if restoreErr := os.Rename(previous, exe); restoreErr != nil {
			s.log.Error("could not put the previous binary back", "path", exe, "err", restoreErr)
			return "failed", step, fmt.Sprintf("%s did not take over (%v), and the previous binary could not be put back at %s (%v): this Bay keeps serving %s, but a restart would start %s", cmd.Version, err, exe, restoreErr, version, cmd.Version)
		}
		return "failed", step, fmt.Sprintf("%s did not take over, so this Bay keeps serving %s: %v", cmd.Version, version, err)
	}
	return "done", "", ""
}

/*
resolveSelf answers the file to replace, and refuses when replacing it would
not change what the successor runs.

tableflip starts the successor from os.Args[0], the path systemd's ExecStart
names. If that and the running executable are not the same file (a relative
path from another directory, a wrapper script), the binary this verb writes is
not the one that would be started.
*/
func resolveSelf() (string, error) {
	running, err := selfExecutable()
	if err != nil {
		return "", fmt.Errorf("this Bay cannot find its own binary: %w", err)
	}
	if running, err = filepath.EvalSymlinks(running); err != nil {
		return "", fmt.Errorf("this Bay cannot find its own binary: %w", err)
	}
	started, err := exec.LookPath(selfArg0())
	if err == nil {
		started, err = filepath.EvalSymlinks(started)
	}
	if err != nil || !sameFile(started, running) {
		return "", fmt.Errorf("this Bay was started as %q, which is not the binary it runs (%s): its successor would start from the first and this upgrade would replace the second. Start Bay by the full path of its binary", selfArg0(), running)
	}
	return running, nil
}

func sameFile(a, b string) bool {
	ia, errA := os.Stat(a)
	ib, errB := os.Stat(b)
	return errA == nil && errB == nil && os.SameFile(ia, ib)
}

// checksumFor reads one file's digest from a SHA256SUMS listing.
func checksumFor(sums, name string) string {
	for _, line := range strings.Split(sums, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && strings.TrimPrefix(fields[1], "*") == name && len(fields[0]) == 64 {
			return strings.ToLower(fields[0])
		}
	}
	return ""
}

func fetch(ctx context.Context, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode != http.StatusOK {
		res.Body.Close()
		return nil, fmt.Errorf("%s answered %d", url, res.StatusCode)
	}
	return res, nil
}

func fetchBytes(ctx context.Context, url string, limit int64) ([]byte, error) {
	res, err := fetch(ctx, url)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	return io.ReadAll(io.LimitReader(res.Body, limit))
}

// fetchFile downloads url into path and answers the SHA-256 of what it wrote.
func fetchFile(ctx context.Context, url, path string, limit int64) (string, error) {
	res, err := fetch(ctx, url)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	out, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return "", err
	}
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(out, hash), io.LimitReader(res.Body, limit+1))
	if closeErr := out.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return "", err
	}
	if n > limit {
		return "", errors.New("the file is larger than any Bay binary")
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

// copyFile writes a copy of src at dst, replacing it atomically.
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".tmp"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	if closeErr := out.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}
