package main

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/connector"
	"github.com/alepha-dev/bay/internal/runner"
)

/*
install.sh, enrolling in the same line (#Q3135).

The real script runs, against stubs on PATH for what a test machine cannot
offer: `uname` and `id` say Linux and root, `curl` serves the release from a
local directory, `docker` answers the installer's two probes and passes
everything else to the real one, and `systemctl` starts the unit the script
wrote by running its ExecStart (with the ports moved to a free loopback one).
What `systemctl` starts is the real `bay serve`, so the connector command the
script runs after it is the real one, and the fake Lore below must see the
machine dial in with the secret.

It is not a systemd host: the unit's contents are asserted as text, and the
start is the stub's. What it proves is the script's order (unit, start, wait,
enrol), that the secret never reaches its output, and that the host
connects.
*/

const installSecret = "est_0123456789abcdef0123456789abcdef"

type installWorld struct {
	prefix, unit, socket, stubs string
	env                         []string
}

func newInstallWorld(t *testing.T) *installWorld {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("install.sh is a POSIX shell script")
	}
	if _, err := runner.NewDocker(""); err != nil {
		if os.Getenv("BAY_REQUIRE_DOCKER") == "1" {
			t.Fatalf("BAY_REQUIRE_DOCKER=1 but %v", err)
		}
		t.Skipf("no Docker daemon (%v): bay serve needs one", err)
	}
	dir := t.TempDir()
	short, err := os.MkdirTemp("", "bay")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(short) })
	w := &installWorld{
		prefix: filepath.Join(dir, "opt"),
		unit:   filepath.Join(dir, "bay.service"),
		socket: filepath.Join(short, "control.sock"),
		stubs:  filepath.Join(dir, "stubs"),
	}

	// The release the stub curl serves: this checkout's bay, as the asset.
	release := filepath.Join(dir, "release")
	if err := os.MkdirAll(release, 0o755); err != nil {
		t.Fatal(err)
	}
	asset := "bay-linux-amd64"
	if out, err := exec.Command("go", "build", "-o", filepath.Join(release, asset), ".").CombinedOutput(); err != nil {
		t.Fatalf("go build: %v\n%s", err, out)
	}
	bin, err := os.ReadFile(filepath.Join(release, asset))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(bin)
	writeInstallFile(t, filepath.Join(release, "SHA256SUMS"), hex.EncodeToString(sum[:])+"  "+asset+"\n", 0o644)

	realDocker, err := exec.LookPath("docker")
	if err != nil {
		t.Skip("no docker CLI on PATH")
	}
	if err := os.MkdirAll(w.stubs, 0o755); err != nil {
		t.Fatal(err)
	}
	stub := func(name, body string) {
		writeInstallFile(t, filepath.Join(w.stubs, name), "#!/bin/sh\n"+body, 0o755)
	}
	stub("uname", `case "$1" in -m) echo x86_64 ;; *) echo Linux ;; esac`+"\n")
	stub("id", "echo 0\n")
	stub("curl", `out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac; done
cp "`+release+`/$(basename "$url")" "$out"
`)
	stub("docker", `case "$1 $2" in
  "version --format") echo 1.47 ;;
  "compose version") echo "Docker Compose version v2" ;;
  *) exec "`+realDocker+`" "$@" ;;
esac
`)
	// enable --now bay runs the unit's ExecStart on a free loopback port
	// instead of :80 and :443; no bay service runs before the install.
	stub("systemctl", `case "$*" in
  "enable --now bay")
    cmd="$(sed -n 's/^ExecStart=//p' "`+w.unit+`" | sed 's/--addr :80 --tls --tls-addr :443/--addr 127.0.0.1:0/')"
    nohup sh -c "exec $cmd" >"`+dir+`/serve.log" 2>&1 &
    echo $! >"`+dir+`/serve.pid"
    ;;
  "is-active"*) exit 3 ;;
esac
exit 0
`)
	t.Cleanup(func() {
		if pid, err := os.ReadFile(filepath.Join(dir, "serve.pid")); err == nil {
			exec.Command("kill", strings.TrimSpace(string(pid))).Run()
		}
	})

	w.env = append(os.Environ(),
		"PATH="+w.stubs+string(os.PathListSeparator)+os.Getenv("PATH"),
		"BAY_VERSION=0.0.0",
		"BAY_PREFIX="+w.prefix,
		"BAY_BIN_LINK="+filepath.Join(dir, "bay-link"),
		"BAY_UNIT="+w.unit,
		"BAY_SOCKET="+w.socket,
		"BAY_ROOT=",
	)
	return w
}

func (w *installWorld) run(t *testing.T, extra ...string) (string, error) {
	t.Helper()
	cmd := exec.Command("sh", "../../install.sh")
	cmd.Env = append(append([]string{}, w.env...), extra...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func writeInstallFile(t *testing.T, path, body string, mode os.FileMode) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), mode); err != nil {
		t.Fatal(err)
	}
}

func TestInstallScriptStartsBayThenEnrolsIt(t *testing.T) {
	w := newInstallWorld(t)

	var dialled atomic.Bool
	lore := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		if r.URL.Path == connector.SocketPath && r.Header.Get("Authorization") == "Bearer "+installSecret {
			dialled.Store(true)
		}
		rw.WriteHeader(http.StatusUnauthorized)
	}))
	t.Cleanup(lore.Close)

	out, err := w.run(t, "LORE_URL="+lore.URL, "LORE_ESTATE_SECRET="+installSecret)
	if err != nil {
		t.Fatalf("install.sh: %v\n%s", err, out)
	}
	if strings.Contains(out, installSecret[4:]) {
		t.Fatalf("the installer printed the secret:\n%s", out)
	}
	unit, err := os.ReadFile(w.unit)
	if err != nil {
		t.Fatalf("no unit written: %v\n%s", err, out)
	}
	for _, want := range []string{
		"ExecStart=" + w.prefix + "/bin/bay serve --root " + w.prefix + "/data",
		"--control-socket " + w.socket,
		"Restart=always",
	} {
		if !strings.Contains(string(unit), want) {
			t.Errorf("unit lacks %q:\n%s", want, unit)
		}
	}
	if !strings.Contains(out, "enrolled with "+lore.URL) {
		t.Errorf("the report does not say it enrolled:\n%s", out)
	}

	deadline := time.Now().Add(15 * time.Second)
	for !dialled.Load() && time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
	}
	if !dialled.Load() {
		t.Fatalf("the host never dialled Lore with its secret\n%s", out)
	}
}

func TestInstallScriptRefusesHalfAnEnrolment(t *testing.T) {
	w := newInstallWorld(t)
	out, err := w.run(t, "LORE_URL=https://lore.example.com")
	if err == nil || !strings.Contains(out, "LORE_ESTATE_SECRET is not") {
		t.Fatalf("want a refusal naming the missing secret, got %v:\n%s", err, out)
	}
	if _, err := os.Stat(w.prefix); err == nil {
		t.Fatal("a half enrolment must refuse before installing anything")
	}
}

func TestInstallScriptWithoutTheVariablesWritesNoUnit(t *testing.T) {
	w := newInstallWorld(t)
	out, err := w.run(t)
	if err != nil {
		t.Fatalf("install.sh: %v\n%s", err, out)
	}
	if _, err := os.Stat(w.unit); err == nil {
		t.Fatal("without LORE_URL and LORE_ESTATE_SECRET the script must not write a unit")
	}
	if !strings.Contains(out, "Next: run bay serve under systemd") {
		t.Errorf("the plain install's next steps are gone:\n%s", out)
	}
}

func TestInstallScriptWithoutSystemdSaysWhatToRun(t *testing.T) {
	w := newInstallWorld(t)
	os.Remove(filepath.Join(w.stubs, "systemctl"))
	// A PATH with the stubs and the tools the script needs, and no systemctl.
	tools := filepath.Join(filepath.Dir(w.stubs), "tools")
	if err := os.MkdirAll(tools, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"sh", "mkdir", "chmod", "mv", "ln", "cat", "grep", "sed", "cut", "awk",
		"mktemp", "rm", "cp", "basename", "dirname", "head", "sha256sum", "shasum", "sleep", "perl"} {
		if p, err := exec.LookPath(name); err == nil {
			os.Symlink(p, filepath.Join(tools, name))
		}
	}
	out, err := w.run(t, "PATH="+w.stubs+string(os.PathListSeparator)+tools,
		"LORE_URL=https://lore.example.com", "LORE_ESTATE_SECRET="+installSecret)
	if err == nil {
		t.Fatalf("want a failure without systemd:\n%s", out)
	}
	for _, want := range []string{"no systemd", "bay serve --root", "bay connector set https://lore.example.com <the host secret>"} {
		if !strings.Contains(out, want) {
			t.Errorf("output lacks %q:\n%s", want, out)
		}
	}
	if strings.Contains(out, installSecret[4:]) {
		t.Fatalf("the installer printed the secret:\n%s", out)
	}
}
