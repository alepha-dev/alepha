package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/alepha-dev/bay/internal/connector"
)

/*
upgradeWorld is a Bay that can be upgraded, and a release to upgrade it to.

The release is an httptest server, standing where GitHub stands. The "binary"
it serves is a shell script that answers `version`, which is all the verb asks
of a binary before it installs it; the handoff itself is a stand-in, since two
real processes are the daemon tests' subject (handoff_daemon_test.go).
*/
type upgradeWorld struct {
	f        *deployFixture
	acts     *actions
	exe      string
	requests atomic.Int32
	// handoffs counts the handoffs started; handoffErr is what they answer.
	handoffs   int
	handoffErr error
	// installed is what the executable held when the handoff started.
	installed string
}

const runningBinary = "#!/bin/sh\necho 0.39.0\n"

func releasedBinary(version string) string {
	return "#!/bin/sh\necho " + version + "\n"
}

// newUpgradeWorld serves `files` as the release `released`, to a Bay running
// 0.39.0 in handoff mode on a host that accepts deploys.
func newUpgradeWorld(t *testing.T, released string, files map[string]string) *upgradeWorld {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the stand-in binary is a shell script")
	}
	w := &upgradeWorld{f: newDeployFixture(t)}
	srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		w.requests.Add(1)
		body, ok := files[strings.TrimPrefix(r.URL.Path, "/"+released+"/")]
		if !ok {
			http.NotFound(rw, r)
			return
		}
		_, _ = rw.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)

	dir := t.TempDir()
	w.exe = filepath.Join(dir, "bay")
	if err := os.WriteFile(w.exe, []byte(runningBinary), 0o755); err != nil {
		t.Fatal(err)
	}
	// Resolved, as the verb resolves it: a temp directory is a symlink on macOS.
	w.exe, _ = filepath.EvalSymlinks(w.exe)

	oldBase, oldVersion, oldArg0, oldExe := releaseBase, version, selfArg0, selfExecutable
	releaseBase, version = srv.URL, "0.39.0"
	selfArg0 = func() string { return w.exe }
	selfExecutable = func() (string, error) { return w.exe, nil }
	t.Cleanup(func() {
		releaseBase, version, selfArg0, selfExecutable = oldBase, oldVersion, oldArg0, oldExe
	})

	w.f.server.upgradeMode = upgradeHandoff
	w.f.server.upgrade = func() error {
		w.handoffs++
		raw, _ := os.ReadFile(w.exe)
		w.installed = string(raw)
		return w.handoffErr
	}
	w.acts = newActions(w.f.server)
	w.acts.Welcome(connector.Welcome{DeployAllowed: true})
	return w
}

// release is the two files a release carries for this architecture.
func release(binary string) map[string]string {
	sum := sha256.Sum256([]byte(binary))
	asset := "bay-linux-" + runtime.GOARCH
	return map[string]string{
		asset:        binary,
		"SHA256SUMS": "0000000000000000000000000000000000000000000000000000000000000000  bay-linux-other\n" + hex.EncodeToString(sum[:]) + "  " + asset + "\n",
	}
}

func (w *upgradeWorld) run(version string) connector.Ack {
	rec := &ackRecorder{}
	w.acts.Command(context.Background(), connector.Command{ID: "c-" + version, Kind: "upgrade", Version: version}, rec.send)
	return rec.acks[len(rec.acks)-1]
}

func (w *upgradeWorld) binary(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile(w.exe)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestUpgrade(t *testing.T) {
	t.Run("installs the release and answers done once the new version serves", func(t *testing.T) {
		w := newUpgradeWorld(t, "0.40.0", release(releasedBinary("0.40.0")))
		ack := w.run("0.40.0")
		if ack.Status != "done" {
			t.Fatalf("ack = %+v", ack)
		}
		if w.handoffs != 1 || w.installed != releasedBinary("0.40.0") {
			t.Fatalf("the handoff must start on the new binary: %d handoff(s), binary %q", w.handoffs, w.installed)
		}
		previous, err := os.ReadFile(filepath.Join(filepath.Dir(w.exe), "bay.previous"))
		if err != nil || string(previous) != runningBinary {
			t.Fatalf("bay.previous must be the binary that was running: %q, %v", previous, err)
		}
		if info, _ := os.Stat(w.exe); info.Mode().Perm() != 0o755 {
			t.Fatalf("mode = %v", info.Mode())
		}
		if _, err := os.Stat(w.exe + ".new"); err == nil {
			t.Fatal("the download was left behind")
		}
		// Frozen for good: this process has handed over.
		if !w.f.server.isFrozen() {
			t.Fatal("a Bay that handed over must stay frozen")
		}
	})

	t.Run("a successor that does not take over puts the previous binary back", func(t *testing.T) {
		w := newUpgradeWorld(t, "0.40.0", release(releasedBinary("0.40.0")))
		w.f.server.upgrade = func() error {
			w.handoffs++
			return errors.New("child pid=42 exited: exit status 1: state.json is from the future")
		}
		ack := w.run("0.40.0")
		if ack.Status != "failed" || ack.Step != "handing over" ||
			!strings.Contains(ack.Reason, "state.json is from the future") || !strings.Contains(ack.Reason, "keeps serving 0.39.0") {
			t.Fatalf("ack = %+v", ack)
		}
		if w.binary(t) != runningBinary {
			t.Fatalf("the executable must be the previous binary again: %q", w.binary(t))
		}
		if w.f.server.isFrozen() {
			t.Fatal("still frozen after a failed upgrade")
		}
	})

	refusals := []struct {
		name    string
		version string
		setup   func(w *upgradeWorld)
		want    string
	}{
		{"a host that does not accept deploys", "0.40.0",
			func(w *upgradeWorld) { w.acts.Welcome(connector.Welcome{DeployAllowed: false}) }, "does not accept deploys"},
		{"an older version: no downgrade over the wire", "0.38.0", nil, "does not go back to 0.38.0"},
		{"a Bay with no release version cannot compare", "0.40.0", func(*upgradeWorld) { version = "dev" }, "no release version (dev)"},
		{"a unit without the drop-in, with the command to run by hand", "0.40.0",
			func(w *upgradeWorld) { w.f.server.upgradeMode = upgradeRestart },
			"sudo BAY_VERSION=0.40.0 BAY_UPDATE_UNIT=yes sh"},
		{"a Bay outside systemd, with the command to run by hand", "0.40.0",
			func(w *upgradeWorld) { w.f.server.upgradeMode = upgradeManual },
			"sudo BAY_VERSION=0.40.0 BAY_UPDATE_UNIT=yes sh"},
		{"a Bay too old to know its mode", "0.40.0",
			func(w *upgradeWorld) { w.f.server.upgradeMode = "" }, "does not run under systemd"},
		{"a backup in flight, named", "0.40.0",
			func(w *upgradeWorld) { _, _ = w.f.server.beginWork("a scheduled backup of demo/production") },
			"a scheduled backup of demo/production"},
		{"a restore holding an instance, named", "0.40.0",
			func(w *upgradeWorld) { w.f.server.claimInstance("demo/production", "restore") }, "a restore of demo/production"},
		{"another handoff in flight", "0.40.0",
			func(w *upgradeWorld) { _ = w.f.server.freeze() }, "a handoff is already running"},
		{"a Bay started as something other than its binary", "0.40.0",
			func(w *upgradeWorld) {
				other := filepath.Join(filepath.Dir(w.exe), "wrapper")
				_ = os.WriteFile(other, []byte("#!/bin/sh\n"), 0o755)
				selfArg0 = func() string { return other }
			}, "is not the binary it runs"},
	}
	for _, tc := range refusals {
		t.Run("refused: "+tc.name, func(t *testing.T) {
			w := newUpgradeWorld(t, "0.40.0", release(releasedBinary("0.40.0")))
			if tc.setup != nil {
				tc.setup(w)
			}
			ack := w.run(tc.version)
			if ack.Status != "failed" || !strings.Contains(ack.Reason, tc.want) {
				t.Fatalf("ack = %+v, want a refusal saying %q", ack, tc.want)
			}
			if n := w.requests.Load(); n != 0 {
				t.Fatalf("refused before any download, and yet %d request(s) went out", n)
			}
			if w.handoffs != 0 || w.binary(t) != runningBinary {
				t.Fatalf("a refusal must change nothing: %d handoff(s), binary %q", w.handoffs, w.binary(t))
			}
		})
	}

	for _, bad := range []string{"", "latest", "v0.40.0", "0.40", "0.40.0-rc.1", "0.40.0 ", "0.40.0; rm -rf /", "../0.40.0", "00.40.0", "0.40.0\n"} {
		t.Run("refused: not a strict x.y.z: "+bad, func(t *testing.T) {
			w := newUpgradeWorld(t, "0.40.0", release(releasedBinary("0.40.0")))
			ack := w.run(bad)
			if ack.Status != "failed" || !strings.Contains(ack.Reason, "is not a version") {
				t.Fatalf("ack = %+v", ack)
			}
			if strings.Contains(ack.Reason, "install.sh | sudo") {
				t.Fatalf("an unchecked version must never reach a command somebody pastes: %s", ack.Reason)
			}
			if w.requests.Load() != 0 {
				t.Fatal("validated before any network call")
			}
		})
	}

	t.Run("the version it already runs is done, with nothing fetched", func(t *testing.T) {
		w := newUpgradeWorld(t, "0.39.0", release(releasedBinary("0.39.0")))
		// Even where an upgrade could not be taken: there is nothing to take.
		w.f.server.upgradeMode = upgradeManual
		ack := w.run("0.39.0")
		if ack.Status != "done" || !strings.Contains(ack.Reason, "already runs 0.39.0") {
			t.Fatalf("ack = %+v", ack)
		}
		if w.requests.Load() != 0 || w.handoffs != 0 {
			t.Fatalf("%d request(s), %d handoff(s)", w.requests.Load(), w.handoffs)
		}
	})

	failures := []struct {
		name  string
		files map[string]string
		step  string
		want  string
	}{
		{"a release that does not exist (404)", map[string]string{}, "downloading", "answered 404"},
		{"a release with no binary for this architecture", map[string]string{"SHA256SUMS": release("x")["SHA256SUMS"]}, "downloading", "answered 404"},
		{"a corrupt download", func() map[string]string {
			files := release(releasedBinary("0.40.0"))
			files["bay-linux-"+runtime.GOARCH] += "# flipped\n"
			return files
		}(), "verifying", "checksum mismatch"},
		{"checksums that do not list the binary", map[string]string{
			"bay-linux-" + runtime.GOARCH: releasedBinary("0.40.0"),
			"SHA256SUMS":                  "0000000000000000000000000000000000000000000000000000000000000000  bay-linux-other\n",
		}, "verifying", "lists no checksum"},
		{"a binary that says it is another version", release(releasedBinary("0.41.0")), "verifying", `says it is "0.41.0", not 0.40.0`},
		{"a binary that does not run", release("#!/bin/sh\nexit 3\n"), "verifying", "does not run"},
	}
	for _, tc := range failures {
		t.Run("failed, and nothing installed: "+tc.name, func(t *testing.T) {
			w := newUpgradeWorld(t, "0.40.0", tc.files)
			ack := w.run("0.40.0")
			if ack.Status != "failed" || ack.Step != tc.step || !strings.Contains(ack.Reason, tc.want) {
				t.Fatalf("ack = %+v, want step %q saying %q", ack, tc.step, tc.want)
			}
			if w.handoffs != 0 || w.binary(t) != runningBinary {
				t.Fatalf("nothing may be installed: %d handoff(s), binary %q", w.handoffs, w.binary(t))
			}
			if _, err := os.Stat(w.exe + ".new"); err == nil {
				t.Fatal("the download was left behind")
			}
			if w.f.server.isFrozen() {
				t.Fatal("frozen by an upgrade that never started its handoff")
			}
		})
	}

	t.Run("an unknown verb's refusal names upgrade among what this Bay runs", func(t *testing.T) {
		w := newUpgradeWorld(t, "0.40.0", nil)
		rec := &ackRecorder{}
		w.acts.Command(context.Background(), connector.Command{ID: "c-x", Kind: "reboot"}, rec.send)
		if reason := rec.acks[len(rec.acks)-1].Reason; !strings.Contains(reason, "upgrade") {
			t.Fatalf("reason = %s", reason)
		}
	})

	t.Run("a Bay that handed over pushes no inventory of its own", func(t *testing.T) {
		w := newUpgradeWorld(t, "0.40.0", release(releasedBinary("0.40.0")))
		kicks := 0
		w.acts.kick = func() { kicks++ }
		if ack := w.run("0.40.0"); ack.Status != "done" {
			t.Fatalf("ack = %+v", ack)
		}
		if kicks != 0 {
			t.Fatal("the old process would report its own version right after saying the new one serves")
		}
	})
}

func TestVersions(t *testing.T) {
	for v, want := range map[string]bool{
		"0.39.0": true, "1.0.0": true, "10.20.30": true,
		"": false, "1.0": false, "v1.0.0": false, "1.0.0-rc.1": false, "1.0.0+build": false,
		"01.0.0": false, "1.0.0.0": false, " 1.0.0": false, "1.0.x": false, "0.38.0-12-g4ad66a8": false,
	} {
		if _, ok := parseVersion(v); ok != want {
			t.Errorf("parseVersion(%q) = %v, want %v", v, ok, want)
		}
	}
	order := []string{"0.9.9", "0.10.0", "0.38.0", "0.38.1", "0.39.0", "1.0.0"}
	for i := 1; i < len(order); i++ {
		a, _ := parseVersion(order[i-1])
		b, _ := parseVersion(order[i])
		if compareVersions(a, b) >= 0 || compareVersions(b, a) <= 0 || compareVersions(a, a) != 0 {
			t.Errorf("%s must be older than %s", order[i-1], order[i])
		}
	}
}

func TestChecksumFor(t *testing.T) {
	sum := strings.Repeat("ab", 32)
	listing := "deadbeef  short\n" + sum + "  bay-linux-amd64\n" + strings.Repeat("cd", 32) + " *bay-linux-arm64\n"
	if got := checksumFor(listing, "bay-linux-amd64"); got != sum {
		t.Fatalf("got %q", got)
	}
	if got := checksumFor(listing, "bay-linux-arm64"); got != strings.Repeat("cd", 32) {
		t.Fatalf("binary-mode entry: %q", got)
	}
	if got := checksumFor(listing, "bay-linux-riscv64"); got != "" {
		t.Fatalf("a file the listing does not carry: %q", got)
	}
	if got := checksumFor(listing, "short"); got != "" {
		t.Fatalf("a digest of the wrong length: %q", got)
	}
}

/*
The upgrade over the wire: the frame Lore's suite validates, through the real
client and the real executor, to the acks Lore reads.

`done` is the last thing the old process says, and it says it once the
successor has taken over (the stand-in handoff has returned).
*/
func TestIntegrationUpgradeOverTheWire(t *testing.T) {
	w := newUpgradeWorld(t, "0.40.0", release(releasedBinary("0.40.0")))
	lore := newStubLore(t)
	lore.setDeployAllowed(true)
	wire(t, w.f, lore)
	s := lore.session(t)

	frame := wireFixture(t, "command-upgrade.json")
	id := frame["id"].(string)
	s.push(t, frame)
	if ack := s.ack(t, id, "running"); ack["step"] != nil && ack["step"] != "" {
		t.Fatalf("the first ack says the command was picked up, nothing more: %v", ack)
	}
	done := s.ack(t, id, "done")
	if done["reason"] != nil && done["reason"] != "" {
		t.Fatalf("done = %v", done)
	}
	if w.handoffs != 1 || w.installed != releasedBinary("0.40.0") {
		t.Fatalf("%d handoff(s), on binary %q", w.handoffs, w.installed)
	}
}

func TestIntegrationUpgradeRefusedWhenTheWelcomeSaidNo(t *testing.T) {
	w := newUpgradeWorld(t, "0.40.0", release(releasedBinary("0.40.0")))
	lore := newStubLore(t)
	lore.setDeployAllowed(false)
	wire(t, w.f, lore)
	s := lore.session(t)

	frame := wireFixture(t, "command-upgrade.json")
	s.push(t, frame)
	ack := s.ack(t, frame["id"].(string), "failed")
	if !strings.Contains(ack["reason"].(string), "does not accept deploys") {
		t.Fatalf("reason %v", ack["reason"])
	}
	if w.requests.Load() != 0 || w.handoffs != 0 {
		t.Fatal("with deploys off, Lore cannot replace the binary: nothing may be fetched")
	}
}
