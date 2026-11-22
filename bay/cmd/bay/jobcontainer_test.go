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
	t.Run("clones then runs claude in the agent image, the credential in claude's env only", func(t *testing.T) {
		w, fake := containerWorld(t)
		last := w.run("job-c1", w.agentSpec(map[string]any{"image": agentImage})).last()
		if last.Status != "done" {
			t.Fatalf("ack = %+v", last)
		}
		if len(fake.steps) != 2 || fake.steps[0].Cmd[0] != "git" || fake.steps[1].Cmd[0] != "claude" {
			t.Fatalf("steps = %+v", fake.steps)
		}
		clone, claude := fake.steps[0], fake.steps[1]
		for _, step := range fake.steps {
			if step.Image != agentImage || step.Network == "" || step.Workspace == "" {
				t.Fatalf("a step ran outside the job's image, network or workspace: %+v", step)
			}
			// gVisor cannot reach Docker's embedded DNS: the proxy's name
			// comes from /etc/hosts.
			if len(step.Hosts) != 1 || step.Hosts[0] != "egress:172.30.0.2" {
				t.Fatalf("a step does not map egress to the proxy's address: %v", step.Hosts)
			}
		}
		if strings.Contains(strings.Join(clone.Env, " "), "CLAUDE_CODE_OAUTH_TOKEN") {
			t.Fatal("the clone step was handed the Claude credential")
		}
		if !strings.Contains(strings.Join(claude.Env, " "), "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-test") {
			t.Fatalf("claude ran without its credential: %v", claude.Env)
		}
		if claude.WorkDir != runner.JobWorkspacePath+"/repo" || claude.Cache == "" {
			t.Fatalf("claude ran in %s with cache %q", claude.WorkDir, claude.Cache)
		}
		args := strings.Join(claude.Cmd, " ")
		if !strings.Contains(args, `--mcp-config {`) || !strings.Contains(args, "Bearer lore_job_0123456789abcdef") {
			t.Fatalf("the MCP config is not passed as a JSON string: %s", args)
		}
		calls := strings.Join(fake.calls, ",")
		if !strings.Contains(calls, "network-") || !strings.Contains(calls, "volume- bay-job-") || !strings.Contains(calls, "egress-") {
			t.Fatalf("the job left its network, workspace or proxy: %s", calls)
		}
		// Its one way out: the proxy, on the spec's list, named in its env.
		if !strings.Contains(calls, "egress+ bay-job-") || !strings.Contains(calls, "api.anthropic.com") {
			t.Fatalf("the egress proxy was not started on the job's list: %s", calls)
		}
		for _, step := range fake.steps {
			if !strings.Contains(strings.Join(step.Env, " "), "HTTPS_PROXY=http://egress:3128") {
				t.Fatalf("a step has no proxy: %v", step.Env)
			}
		}
	})

	t.Run("a refused host is a line of the job's log", func(t *testing.T) {
		w, fake := containerWorld(t)
		fake.exitWith["claude"] = 0
		done := w.run("job-c6", w.agentSpec(map[string]any{"image": agentImage})).last()
		if done.Status != "done" {
			t.Fatalf("ack = %+v", done)
		}
		log, err := openJobLog(t.TempDir(), "refusals")
		if err != nil {
			t.Fatal(err)
		}
		_, _ = egressLog{log}.Write([]byte(`{"event":"egress.refused","method":"CONNECT","host":"evil.example","at":"x"}` + "\n"))
		if tail := log.stderrTail(400); !strings.Contains(tail, "egress refused: CONNECT evil.example") {
			t.Fatalf("the refusal reached the log as %q", tail)
		}
	})

	t.Run("refuses a spec that names no image", func(t *testing.T) {
		w, fake := containerWorld(t)
		last := w.run("job-c2", w.agentSpec(nil)).last()
		if last.Status != "failed" || !strings.Contains(last.Reason, "names none") || len(fake.steps) != 0 {
			t.Fatalf("ack = %+v, steps %d", last, len(fake.steps))
		}
	})

	t.Run("refuses gVisor on a daemon without runsc", func(t *testing.T) {
		w, fake := containerWorld(t)
		_ = saveJobsConfig(w.f.root, jobsConfig{Runner: "container", GVisor: true})
		last := w.run("job-c3", w.agentSpec(map[string]any{"image": agentImage})).last()
		if last.Status != "failed" || !strings.Contains(last.Reason, "no runsc") || len(fake.steps) != 0 {
			t.Fatalf("ack = %+v", last)
		}
		fake.runsc = true
		last = w.run("job-c4", w.agentSpec(map[string]any{"image": agentImage})).last()
		if last.Status != "done" || fake.steps[0].Runtime != "runsc" {
			t.Fatalf("ack = %+v, runtime %q", last, fake.steps[0].Runtime)
		}
	})

	t.Run("refuses to run claude without the credential it names", func(t *testing.T) {
		w, _ := containerWorld(t)
		_ = saveHostSecrets(w.f.root, map[string]string{})
		last := w.run("job-c5", w.agentSpec(map[string]any{"image": agentImage})).last()
		if last.Status != "failed" || !strings.Contains(last.Reason, "bay secret set CLAUDE_CODE_OAUTH_TOKEN") {
			t.Fatalf("ack = %+v", last)
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
