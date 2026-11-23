package main

import (
	"context"
	"fmt"
	"io"
	"strings"
	"sync"
	"testing"

	"github.com/alepha-dev/bay/internal/connector"
	"github.com/alepha-dev/bay/internal/runner"
)

// fakeJobDocker records what the container runner asks of the daemon.
type fakeJobDocker struct {
	mu        sync.Mutex
	steps     []runner.JobContainer
	calls     []string
	runsc     bool
	exitWith  map[string]int
	egressOut io.Writer
}

func (f *fakeJobDocker) log(s string)                    { f.mu.Lock(); f.calls = append(f.calls, s); f.mu.Unlock() }
func (f *fakeJobDocker) EnsureJobNetwork(n string) error { f.log("network+ " + n); return nil }
func (f *fakeJobDocker) RemoveJobNetwork(n string) error { f.log("network- " + n); return nil }
func (f *fakeJobDocker) CreateJobVolume(n string) error  { f.log("volume+ " + n); return nil }
func (f *fakeJobDocker) RemoveJobVolume(n string) error  { f.log("volume- " + n); return nil }
func (f *fakeJobDocker) HasRuntime(string) (bool, error) { return f.runsc, nil }
func (f *fakeJobDocker) StartEgress(_ context.Context, s runner.EgressSidecar, out io.Writer) (func(), string, error) {
	f.log("egress+ " + s.Network + " " + strings.Join(s.Allow, ","))
	f.mu.Lock()
	f.egressOut = out
	f.mu.Unlock()
	return func() { f.log("egress-") }, "172.30.0.2", nil
}
func (f *fakeJobDocker) RunJob(_ context.Context, c runner.JobContainer, stdout, _ io.Writer) (int, error) {
	f.mu.Lock()
	f.steps = append(f.steps, c)
	f.mu.Unlock()
	fmt.Fprintf(stdout, "ran %s\n", c.Cmd[0])
	return f.exitWith[c.Cmd[0]], nil
}

const agentImage = "ghcr.io/alepha-dev/lore-agent@sha256:" + "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func containerWorld(t *testing.T) (*jobWorld, *fakeJobDocker) {
	t.Helper()
	w := newJobWorld(t)
	if err := saveJobsConfig(w.f.root, jobsConfig{Runner: "container", Credential: "CLAUDE_CODE_OAUTH_TOKEN"}); err != nil {
		t.Fatal(err)
	}
	if err := saveHostSecrets(w.f.root, map[string]string{"CLAUDE_CODE_OAUTH_TOKEN": "sk-ant-oat-test"}); err != nil {
		t.Fatal(err)
	}
	fake := &fakeJobDocker{exitWith: map[string]int{}}
	w.acts.jobs.container.docker = func() (jobDocker, error) { return fake, nil }
	w.acts.jobs.container.binary = func() (string, error) { return "/usr/local/bin/bay", nil }
	return w, fake
}

func TestContainerRunner(t *testing.T) {
	t.Run("refuses every job: a job runs an agent CLI in a workspace on the host (#Q4219)", func(t *testing.T) {
		w, fake := containerWorld(t)
		for id, spec := range map[string][]byte{"job-c1": w.agentSpec(nil), "job-c2": w.checkSpec(nil)} {
			last := w.run(id, spec).last()
			if last.Status != "failed" || !strings.Contains(last.Reason, "process runner") || len(fake.steps) != 0 {
				t.Fatalf("ack = %+v, steps %d", last, len(fake.steps))
			}
		}
	})

	t.Run("reports the container runner and the secrets' names, never a value", func(t *testing.T) {
		w, _ := containerWorld(t)
		inv, _ := w.acts.Inventory(context.Background())
		if inv.Jobs == nil || inv.Jobs.Runner != "container" ||
			len(inv.Jobs.Secrets) != 1 || inv.Jobs.Secrets[0] != "CLAUDE_CODE_OAUTH_TOKEN" {
			t.Fatalf("jobs block = %+v", inv.Jobs)
		}
		var _ = connector.InventoryJobs{}
	})
}

func TestHostSecrets(t *testing.T) {
	root := t.TempDir()
	if err := cmdHostSecret([]string{"set", "ANTHROPIC_API_KEY", "-", "--root", root}, strings.NewReader("sk-1\n")); err != nil {
		t.Fatal(err)
	}
	if err := cmdHostSecret([]string{"set", "ANTHROPIC_API_KEY", "sk-on-argv", "--root", root}, strings.NewReader("")); err == nil {
		t.Fatal("a value on the command line was accepted")
	}
	if err := cmdHostSecret([]string{"set", "bad name", "-", "--root", root}, strings.NewReader("x")); err == nil {
		t.Fatal("a name that is not a variable was accepted")
	}
	secrets, _ := loadHostSecrets(root)
	if secrets["ANTHROPIC_API_KEY"] != "sk-1" {
		t.Fatalf("secrets = %v", secrets)
	}
	if names := hostSecretNames(root); len(names) != 1 || names[0] != "ANTHROPIC_API_KEY" {
		t.Fatalf("names = %v", names)
	}
}
