package main

import (
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/runner"
)

/*
A check really run by the container runner against a Docker daemon (#Q3999),
in the stub agent image: it runs claude with its credential, and finds no route out, a read-only root filesystem and a non-root
user. Skips without a daemon unless BAY_REQUIRE_DOCKER=1.
*/
func TestContainerJobDaemon(t *testing.T) {
	d := daemonDocker(t)
	build := exec.Command("docker", "build", "-q", filepath.Join("..", "..", "testdata", "agent-stub"))
	out, err := build.CombinedOutput()
	if err != nil {
		t.Fatalf("docker build of the stub agent image: %v\n%s", err, out)
	}
	image := strings.TrimSpace(string(out))
	if !strings.HasPrefix(image, "sha256:") {
		t.Fatalf("docker build answered %q", image)
	}

	// The egress proxy runs Bay's own binary in its sidecar: a Linux build,
	// in a directory the daemon can mount.
	binDir := daemonRoot(t, d)
	binary := filepath.Join(binDir, "bay-linux")
	cross := exec.Command("go", "build", "-o", binary, ".")
	cross.Env = append(cross.Environ(), "GOOS=linux", "GOARCH="+runtime.GOARCH, "CGO_ENABLED=0")
	if out, err := cross.CombinedOutput(); err != nil {
		t.Fatalf("cross-compile bay for the egress proxy: %v\n%s", err, out)
	}

	w, _ := containerWorld(t)
	w.acts.jobs.container.docker = func() (jobDocker, error) { return d, nil }
	w.acts.jobs.container.binary = func() (string, error) { return binary, nil }

	last := w.run("job-daemon-1", w.checkSpec(map[string]any{
		"image": image, "egress": []string{"example.com"},
	})).last()
	if last.Status != "done" {
		t.Fatalf("ack = %+v\nstderr: %s", last, w.frames.text("stderr"))
	}
	log := w.frames.text("stdout")
	for _, want := range []string{
		`"result":"OK"`,
		"direct: offline",
		"listed: reached",
		"unlisted: refused",
		"credential: present",
		"rootfs: read-only",
		"user: 1000",
		"cwd: " + runner.JobWorkspacePath,
	} {
		if !strings.Contains(log, want) {
			t.Errorf("the job's log lacks %q:\n%s", want, log)
		}
	}
	if !strings.Contains(w.frames.text("stderr"), "egress refused: GET evil.example") {
		t.Errorf("the refusal is not in the job's log:\n%s", w.frames.text("stderr"))
	}
	if strings.Contains(log, "sk-ant-oat-test") {
		t.Fatal("the credential's value reached the log")
	}
}
