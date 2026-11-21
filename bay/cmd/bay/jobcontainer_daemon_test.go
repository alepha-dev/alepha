package main

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alepha-dev/bay/internal/runner"
)

/*
A job really run by the container runner against a Docker daemon (#Q3999),
in the stub agent image: it clones into its workspace, runs claude with its
credential, and finds no route out, a read-only root filesystem and a non-root
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

	w, _ := containerWorld(t)
	w.acts.jobs.container.docker = func() (jobDocker, error) { return d, nil }

	last := w.run("job-daemon-1", w.agentSpec(map[string]any{"image": image})).last()
	if last.Status != "done" {
		t.Fatalf("ack = %+v\nstderr: %s", last, w.frames.text("stderr"))
	}
	log := w.frames.text("stdout")
	for _, want := range []string{
		`"result":"OK"`,
		"net: offline",
		"credential: present",
		"rootfs: read-only",
		"user: 1000",
		"cwd: " + runner.JobWorkspacePath + "/repo",
	} {
		if !strings.Contains(log, want) {
			t.Errorf("the job's log lacks %q:\n%s", want, log)
		}
	}
	if strings.Contains(log, "sk-ant-oat-test") {
		t.Fatal("the credential's value reached the log")
	}
}
