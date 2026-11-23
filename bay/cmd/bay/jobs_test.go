package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/connector"
)

// frameRecorder stands in for the socket: it keeps every log frame, and can
// be told to refuse them, as a dropped connection does.
type frameRecorder struct {
	mu     sync.Mutex
	frames []connector.LogFrame
	down   bool
}

func (r *frameRecorder) send(frame any) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.down {
		return connector.ErrNotConnected
	}
	if f, ok := frame.(connector.LogFrame); ok {
		r.frames = append(r.frames, f)
	}
	return nil
}

// text is what Lore would hold for a stream: each frame's bytes past what it
// already has, by offset, as the Lore side keeps them.
func (r *frameRecorder) text(stream string) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	var held []byte
	for _, f := range r.frames {
		if f.Stream != stream {
			continue
		}
		end := f.Offset + int64(len(f.Data))
		if end > int64(len(held)) && f.Offset <= int64(len(held)) {
			held = append(held, f.Data[int64(len(held))-f.Offset:]...)
		}
	}
	return string(held)
}

// jobWorld is a machine set up to run jobs: a fake sink serving one spec, a
// stub claude on the jobs user's PATH, and the test's own user as the jobs
// user (a test cannot switch users).
type jobWorld struct {
	f      *deployFixture
	acts   *actions
	frames *frameRecorder
	sink   *httptest.Server
	bin    string
	work   string
	specs  sync.Map
}

func newJobWorld(t *testing.T) *jobWorld {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("jobs run on unix hosts")
	}
	w := &jobWorld{f: newDeployFixture(t), frames: &frameRecorder{}, bin: t.TempDir(), work: t.TempDir()}
	w.sink = httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/estates/commands/"), "/job")
		spec, ok := w.specs.Load(id)
		if !ok || !strings.HasSuffix(r.URL.Path, "/job") || r.Header.Get("Authorization") != "Bearer est_test_secret" {
			rw.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = rw.Write(spec.([]byte))
	}))
	t.Cleanup(w.sink.Close)
	if err := connector.NewStore(w.f.root).Set(connector.Config{Sink: w.sink.URL, Secret: "est_test_secret"}); err != nil {
		t.Fatal(err)
	}
	me, err := user.Current()
	if err != nil {
		t.Fatal(err)
	}
	if err := saveJobsConfig(w.f.root, jobsConfig{User: me.Username}); err != nil {
		t.Fatal(err)
	}
	w.acts = newActions(w.f.server)
	w.acts.Welcome(connector.Welcome{JobsAllowed: true})
	w.acts.sendFrame = w.frames.send
	w.acts.generation = func() uint64 { return 1 }
	r := w.acts.jobs.runner
	r.testRunAsSelf = true
	r.jobsBase = w.work
	r.pathDirs = func(string) []string { return []string{w.bin, "/usr/bin", "/bin"} }
	r.killGrace = time.Second
	jobSecond = 50 * time.Millisecond
	t.Cleanup(func() { jobSecond = time.Second })
	return w
}

// stub writes an executable script onto the jobs user's PATH.
func (w *jobWorld) stub(t *testing.T, name, script string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(w.bin, name), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
}

func (w *jobWorld) agentSpec(overrides map[string]any) []byte {
	spec := map[string]any{
		"kind":           "agent",
		"agent":          "claude",
		"project":        "acme",
		"workspace":      "triage",
		"key":            "lore_job_0123456789abcdef",
		"mcpUrl":         w.sink.URL + "/mcp",
		"prompt":         "Triage the inbox.",
		"timeoutSeconds": 60,
	}
	for k, v := range overrides {
		if v == nil {
			delete(spec, k)
		} else {
			spec[k] = v
		}
	}
	raw, _ := json.Marshal(spec)
	return raw
}

func (w *jobWorld) checkSpec(overrides map[string]any) []byte {
	spec := map[string]any{"kind": "check", "agent": "claude", "timeoutSeconds": 60}
	for k, v := range overrides {
		spec[k] = v
	}
	raw, _ := json.Marshal(spec)
	return raw
}

func (w *jobWorld) run(id string, spec []byte) *ackRecorder {
	w.specs.Store(id, spec)
	rec := &ackRecorder{}
	w.acts.Command(context.Background(), connector.Command{ID: id, Kind: "job-run"}, rec.send)
	return rec
}

func TestJobRun(t *testing.T) {
	t.Run("runs claude in its workspace, streams its output, acks done and keeps the workspace", func(t *testing.T) {
		w := newJobWorld(t)
		// The cwd and args are recorded through files the stub can reach.
		w.stub(t, "claude", `#!/bin/sh
printf '%s\n' "$@" > "`+w.bin+`/claude.args"
pwd > "`+w.bin+`/claude.cwd"
printf '%s' "$LORE_JOB_KEY" > "`+w.bin+`/claude.key"
echo '{"type":"system","subtype":"init"}'
echo '{"type":"result","total_cost_usd":0.01}'
echo 'a warning' >&2
touch cloned-here
`)
		rec := w.run("job-1", w.agentSpec(nil))

		last := rec.last()
		if last.Status != "done" || last.ExitCode == nil || *last.ExitCode != 0 {
			t.Fatalf("ack = %+v, want done with exit 0", last)
		}
		if got := w.frames.text("stdout"); got != "{\"type\":\"system\",\"subtype\":\"init\"}\n{\"type\":\"result\",\"total_cost_usd\":0.01}\n" {
			t.Fatalf("stdout reached Lore as %q", got)
		}
		stderr := w.frames.text("stderr")
		if !strings.Contains(stderr, "a warning") {
			t.Fatalf("stderr reached Lore as %q", stderr)
		}
		// Each step of the run is a timestamped line of the log.
		for _, step := range []string{"workspace acme/triage ready", "agent claude started", "agent exited with status 0"} {
			if !strings.Contains(stderr, step) {
				t.Fatalf("the log lacks the step %q: %q", step, stderr)
			}
		}
		args, _ := os.ReadFile(filepath.Join(w.bin, "claude.args"))
		// The key is in the environment, the MCP config names its variable.
		mcp := `{"mcpServers":{"lore":{"headers":{"Authorization":"Bearer ${LORE_JOB_KEY}"},"type":"http","url":"` + w.sink.URL + `/mcp"}}}`
		want := []string{"-p", "Triage the inbox.", "--output-format", "stream-json", "--verbose",
			"--permission-mode", "bypassPermissions", "--mcp-config", mcp, "--strict-mcp-config"}
		if got := strings.Split(strings.TrimSuffix(string(args), "\n"), "\n"); !equalStrings(got, want) {
			t.Fatalf("claude ran as %q\nwant        %q", got, want)
		}
		if key, _ := os.ReadFile(filepath.Join(w.bin, "claude.key")); string(key) != "lore_job_0123456789abcdef" {
			t.Fatalf("the job key reached claude's environment as %q", key)
		}
		if strings.Contains(string(args), "lore_job_0123456789abcdef") {
			t.Fatal("the job key is on the command line")
		}
		cwd, _ := os.ReadFile(filepath.Join(w.bin, "claude.cwd"))
		work, _ := filepath.EvalSymlinks(w.work)
		if got := strings.TrimSpace(string(cwd)); got != filepath.Join(work, "acme", "triage") {
			t.Fatalf("claude ran in %q, want the workspace", got)
		}
		// Bay does no git, and writes nothing beside the workspace.
		entries, _ := os.ReadDir(filepath.Join(w.work, "acme", "triage"))
		if len(entries) != 1 || entries[0].Name() != "cloned-here" {
			t.Fatalf("the workspace holds %v, want only what the agent left", entries)
		}
		if _, err := os.Stat(jobLogDir(w.f.root, "job-1")); !os.IsNotExist(err) {
			t.Fatal("a spool that reached Lore whole was kept")
		}

		// The next run of the workspace finds it as the last one left it.
		w.stub(t, "claude", "#!/bin/sh\ntest -f cloned-here\n")
		if last := w.run("job-2", w.agentSpec(nil)).last(); last.Status != "done" {
			t.Fatalf("the second run did not find the workspace: %+v", last)
		}
	})

	t.Run("a check asks the agent its version, then its fixed question, with nothing in reach", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "claude", `#!/bin/sh
if [ "$1" = "--version" ]; then echo "2.1.7 (Claude Code)"; exit 0; fi
printf '%s\n' "$@" > "`+w.bin+`/claude.args"
printf '%s' "$LORE_JOB_KEY" > "`+w.bin+`/claude.key"
echo 'OK'
`)
		rec := w.run("check-1", w.checkSpec(nil))
		if rec.last().Status != "done" {
			t.Fatalf("ack = %+v", rec.last())
		}
		args, _ := os.ReadFile(filepath.Join(w.bin, "claude.args"))
		if got := strings.Fields(string(args)); !equalStrings(got, []string{"-p", "reply", "OK", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions"}) {
			t.Fatalf("a check ran claude as %q", got)
		}
		if key, _ := os.ReadFile(filepath.Join(w.bin, "claude.key")); len(key) != 0 {
			t.Fatal("a check was handed a key")
		}
		if !strings.Contains(w.frames.text("stderr"), "claude 2.1.7") {
			t.Fatalf("the check's log does not say the version: %q", w.frames.text("stderr"))
		}
		if entries, _ := os.ReadDir(w.work); len(entries) != 0 {
			t.Fatalf("a check made a workspace: %v", entries)
		}
	})

	t.Run("a check fails when the agent's version command does", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "claude", "#!/bin/sh\nexit 2\n")
		last := w.run("check-broken", w.checkSpec(nil)).last()
		if last.Status != "failed" || !strings.Contains(last.Reason, "claude --version exited with status 2") {
			t.Fatalf("ack = %+v", last)
		}
	})

	t.Run("the run's model reaches the agent, and none leaves the CLI's own default", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "claude", `#!/bin/sh
if [ "$1" = "--version" ]; then echo "2.1.7"; exit 0; fi
printf '%s\n' "$@" > "`+w.bin+`/claude.args"
`)
		if rec := w.run("check-model", w.checkSpec(map[string]any{"model": "claude-opus-5-5"})); rec.last().Status != "done" {
			t.Fatalf("ack = %+v", rec.last())
		}
		args, _ := os.ReadFile(filepath.Join(w.bin, "claude.args"))
		if !strings.Contains(string(args), "--model\nclaude-opus-5-5\n") {
			t.Fatalf("a check ran claude as %q", args)
		}
		if rec := w.run("job-model", w.agentSpec(map[string]any{"model": "sonnet"})); rec.last().Status != "done" {
			t.Fatalf("ack = %+v", rec.last())
		}
		args, _ = os.ReadFile(filepath.Join(w.bin, "claude.args"))
		if !strings.Contains(string(args), "--model\nsonnet\n") {
			t.Fatalf("an agent job ran claude as %q", args)
		}
		if rec := w.run("job-default", w.agentSpec(nil)); rec.last().Status != "done" {
			t.Fatalf("ack = %+v", rec.last())
		}
		args, _ = os.ReadFile(filepath.Join(w.bin, "claude.args"))
		if strings.Contains(string(args), "--model") {
			t.Fatalf("a run with no model named one: %q", args)
		}
	})

	t.Run("runs Gemini CLI with a settings file of its own for Lore's MCP, removed after", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "gemini", `#!/bin/sh
printf '%s\n' "$@" > "`+w.bin+`/gemini.args"
printf '%s' "$GEMINI_CLI_SYSTEM_SETTINGS_PATH" > "`+w.bin+`/gemini.path"
cat "$GEMINI_CLI_SYSTEM_SETTINGS_PATH" > "`+w.bin+`/gemini.settings"
printf '%s' "$LORE_JOB_KEY" > "`+w.bin+`/gemini.key"
pwd > "`+w.bin+`/gemini.cwd"
`)
		last := w.run("job-gemini", w.agentSpec(map[string]any{"agent": "gemini", "model": "gemini-2.5-pro", "workspace": "q12"})).last()
		if last.Status != "done" {
			t.Fatalf("ack = %+v", last)
		}
		args, _ := os.ReadFile(filepath.Join(w.bin, "gemini.args"))
		want := []string{"-p", "Triage the inbox.", "--output-format", "stream-json", "--approval-mode", "yolo", "--skip-trust",
			"--model", "gemini-2.5-pro", "--allowed-mcp-server-names", "lore"}
		if got := strings.Split(strings.TrimSuffix(string(args), "\n"), "\n"); !equalStrings(got, want) {
			t.Fatalf("gemini ran as %q\nwant        %q", got, want)
		}
		settings, _ := os.ReadFile(filepath.Join(w.bin, "gemini.settings"))
		wantSettings := `{"mcpServers":{"lore":{"headers":{"Authorization":"Bearer ${LORE_JOB_KEY}"},"httpUrl":"` + w.sink.URL + `/mcp"}}}`
		if string(settings) != wantSettings {
			t.Fatalf("gemini's settings = %s", settings)
		}
		if key, _ := os.ReadFile(filepath.Join(w.bin, "gemini.key")); string(key) != "lore_job_0123456789abcdef" {
			t.Fatalf("the key reached gemini's environment as %q", key)
		}
		path, _ := os.ReadFile(filepath.Join(w.bin, "gemini.path"))
		if _, err := os.Stat(string(path)); !os.IsNotExist(err) {
			t.Fatalf("the settings file %s outlived the run", path)
		}
		cwd, _ := os.ReadFile(filepath.Join(w.bin, "gemini.cwd"))
		if !strings.HasSuffix(strings.TrimSpace(string(cwd)), filepath.Join("acme", "q12")) {
			t.Fatalf("gemini ran in %q", cwd)
		}
		if entries, _ := os.ReadDir(filepath.Join(w.work, "acme", "q12")); len(entries) != 0 {
			t.Fatalf("the workspace holds %v: the settings belong outside it", entries)
		}
	})

	t.Run("an agent this bay has no adapter for is refused with the ones it has", func(t *testing.T) {
		w := newJobWorld(t)
		last := w.run("job-codex", w.agentSpec(map[string]any{"agent": "codex"})).last()
		if last.Status != "failed" || last.Step != "validating" || !strings.Contains(last.Reason, "claude, gemini") {
			t.Fatalf("ack = %+v", last)
		}
	})

	t.Run("an agent missing from the jobs user's PATH is a failed job that says so", func(t *testing.T) {
		w := newJobWorld(t)
		last := w.run("job-nogemini", w.agentSpec(map[string]any{"agent": "gemini"})).last()
		if last.Status != "failed" || !strings.Contains(last.Reason, "gemini is not on the jobs user's PATH") {
			t.Fatalf("ack = %+v", last)
		}
	})

	t.Run("a non-zero exit is a failed ack with its code and stderr's tail", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "claude", "#!/bin/sh\necho 'Invalid API key' >&2\nexit 3\n")
		last := w.run("job-fail", w.agentSpec(nil)).last()
		if last.Status != "failed" || last.ExitCode == nil || *last.ExitCode != 3 || !strings.Contains(last.Reason, "Invalid API key") {
			t.Fatalf("ack = %+v", last)
		}
	})

	t.Run("a timeout kills the process group and acks timed_out", func(t *testing.T) {
		w := newJobWorld(t)
		// A child that would outlive its parent if only the parent were killed.
		w.stub(t, "claude", "#!/bin/sh\nsleep 30 &\necho started\nwait\n")
		start := time.Now()
		last := w.run("job-slow", w.agentSpec(map[string]any{"timeoutSeconds": 20})).last()
		if last.Status != connector.AckTimedOut || last.ExitCode != nil {
			t.Fatalf("ack = %+v, want timed_out", last)
		}
		if time.Since(start) > 10*time.Second {
			t.Fatal("the timeout did not kill the sleeping child")
		}
		if !strings.Contains(w.frames.text("stderr"), "timeout") {
			t.Fatalf("the log does not say why: %q", w.frames.text("stderr"))
		}
	})

	t.Run("a job-cancel kills it and the run acks cancelled", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "claude", "#!/bin/sh\nsleep 30 &\nwait\n")
		done := make(chan *ackRecorder)
		go func() { done <- w.run("job-long", w.agentSpec(map[string]any{"timeoutSeconds": 3600})) }()
		waitFor(t, func() bool { return w.acts.jobs.runningIDs() == "job-long" })
		time.Sleep(200 * time.Millisecond)

		cancel := &ackRecorder{}
		w.acts.Command(context.Background(), connector.Command{ID: "cancel-1", Kind: "job-cancel", JobCommandID: "job-long"}, cancel.send)
		if cancel.last().Status != "done" {
			t.Fatalf("cancel ack = %+v", cancel.last())
		}
		select {
		case rec := <-done:
			if rec.last().Status != connector.AckCancelled {
				t.Fatalf("run ack = %+v, want cancelled", rec.last())
			}
		case <-time.After(10 * time.Second):
			t.Fatal("the cancelled job did not end")
		}
	})
}

func TestJobRunRefusals(t *testing.T) {
	t.Run("without jobsAllowed", func(t *testing.T) {
		w := newJobWorld(t)
		w.acts.Welcome(connector.Welcome{JobsAllowed: false, DeployAllowed: true})
		last := w.run("job-off", w.agentSpec(nil)).last()
		if last.Status != "failed" || !strings.Contains(last.Reason, "does not run jobs") {
			t.Fatalf("ack = %+v", last)
		}
	})

	t.Run("without a jobs user", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "claude", "#!/bin/sh\nexit 0\n")
		if err := saveJobsConfig(w.f.root, jobsConfig{}); err != nil {
			t.Fatal(err)
		}
		last := w.run("job-nouser", w.agentSpec(nil)).last()
		if last.Status != "failed" || !strings.Contains(last.Reason, "bay config jobs --user") {
			t.Fatalf("ack = %+v", last)
		}
	})

	t.Run("when bay cannot become the jobs user", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "claude", "#!/bin/sh\nexit 0\n")
		r := w.acts.jobs.runner
		r.testRunAsSelf, r.switchUser, r.selfUID = false, false, -1
		last := w.run("job-noroot", w.agentSpec(nil)).last()
		if last.Status != "failed" || !strings.Contains(last.Reason, "not running as root") {
			t.Fatalf("ack = %+v", last)
		}
	})

	t.Run("a second job while one runs, at the default limit of one", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "claude", "#!/bin/sh\nsleep 30 &\nwait\n")
		go w.run("job-a", w.agentSpec(map[string]any{"timeoutSeconds": 3600}))
		waitFor(t, func() bool { return w.acts.jobs.runningIDs() == "job-a" })
		last := w.run("job-b", w.agentSpec(map[string]any{"workspace": "other"})).last()
		if last.Status != "failed" || !strings.Contains(last.Reason, "its limit") {
			t.Fatalf("ack = %+v", last)
		}
		w.acts.jobs.stop("job-a")
		waitFor(t, func() bool { return w.acts.jobs.runningIDs() == "" })
	})

	t.Run("a raised limit runs two jobs, never two in one workspace", func(t *testing.T) {
		w := newJobWorld(t)
		cfg, _ := loadJobsConfig(w.f.root)
		cfg.MaxJobs = 2
		if err := saveJobsConfig(w.f.root, cfg); err != nil {
			t.Fatal(err)
		}
		w.stub(t, "claude", "#!/bin/sh\nsleep 30 &\nwait\n")
		go w.run("job-a", w.agentSpec(map[string]any{"timeoutSeconds": 3600}))
		waitFor(t, func() bool { return w.acts.jobs.runningIDs() == "job-a" })
		waitFor(t, func() bool { return strings.Contains(w.frames.text("stderr"), "agent claude started") })
		last := w.run("job-same", w.agentSpec(nil)).last()
		if last.Status != "failed" || !strings.Contains(last.Reason, "already runs in the workspace acme/triage") {
			t.Fatalf("ack = %+v", last)
		}
		go w.run("job-b", w.agentSpec(map[string]any{"workspace": "q12", "timeoutSeconds": 3600}))
		waitFor(t, func() bool { return w.acts.jobs.runningIDs() == "job-a,job-b" })
		w.acts.jobs.stop("job-a")
		w.acts.jobs.stop("job-b")
		waitFor(t, func() bool { return w.acts.jobs.runningIDs() == "" })
	})

	t.Run("a job never waits for the machine mutex", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "claude", "#!/bin/sh\necho ok\n")
		// A deploy holds the machine; the job runs all the same.
		w.acts.mu.Lock()
		defer w.acts.mu.Unlock()
		done := make(chan string)
		go func() { done <- w.run("job-free", w.agentSpec(nil)).last().Status }()
		select {
		case status := <-done:
			if status != "done" {
				t.Fatalf("status = %s", status)
			}
		case <-time.After(10 * time.Second):
			t.Fatal("the job waited for the deploy mutex")
		}
	})

	t.Run("a spec this bay does not accept runs nothing", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "claude", "#!/bin/sh\ntouch \""+w.bin+"/ran\"\n")
		last := w.run("job-bad", w.agentSpec(map[string]any{"allowedTools": []string{"Bash"}})).last()
		if last.Status != "failed" || last.Step != "validating" {
			t.Fatalf("ack = %+v", last)
		}
		if _, err := os.Stat(filepath.Join(w.bin, "ran")); !os.IsNotExist(err) {
			t.Fatal("claude ran on a refused spec")
		}
	})
}

func TestJobsUser(t *testing.T) {
	cases := []struct {
		uid, self string
		ok        bool
	}{
		{"0", "0", false},       // root
		{"1001", "1001", false}, // bay's own user
		{"1001", "0", true},     // a dedicated user, bay as root
	}
	for _, c := range cases {
		self := 0
		if c.self == "1001" {
			self = 1001
		}
		err := checkJobsUser(&user.User{Uid: c.uid, Username: "u" + c.uid}, self)
		if (err == nil) != c.ok {
			t.Fatalf("uid %s as bay %s: err = %v", c.uid, c.self, err)
		}
	}
}

func TestModelPattern(t *testing.T) {
	for _, ok := range []string{"opus", "sonnet", "claude-opus-5-5", "claude-sonnet-5-5", "sonnet[1m]", "claude-haiku-4.5", "gemini-2.5-pro", "flash"} {
		if !modelPattern.MatchString(ok) {
			t.Errorf("%q refused", ok)
		}
	}
	for _, bad := range []string{"", "-p", "--dangerously-skip-permissions", "Opus", "opus 5", "opus;rm", "opus\n"} {
		if modelPattern.MatchString(bad) {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestJobSpecValidation(t *testing.T) {
	sink := "https://lore.example.com"
	base := func() map[string]any {
		return map[string]any{
			"kind": "agent", "agent": "claude", "model": "opus",
			"project":        "acme",
			"workspace":      "q12",
			"key":            "lore_job_0123456789abcdef",
			"mcpUrl":         sink + "/mcp",
			"prompt":         "Work on it.",
			"timeoutSeconds": 3600,
		}
	}
	parse := func(m map[string]any) error {
		raw, _ := json.Marshal(m)
		_, err := parseJobSpec(raw, sink)
		return err
	}
	if err := parse(base()); err != nil {
		t.Fatalf("a valid spec was refused: %v", err)
	}
	refused := map[string]func(m map[string]any){
		"an unknown field":          func(m map[string]any) { m["shell"] = "rm -rf /" },
		"a repository to clone":     func(m map[string]any) { m["repository"] = map[string]any{"cloneUrl": sink + "/a.git", "ref": "main"} },
		"Claude's own vocabulary":   func(m map[string]any) { m["allowedTools"] = []string{"Read"} },
		"a turn budget":             func(m map[string]any) { m["maxTurns"] = 30 },
		"a profile":                 func(m map[string]any) { m["profile"] = "push" },
		"an egress list":            func(m map[string]any) { m["egress"] = []string{"github.com"} },
		"an image":                  func(m map[string]any) { m["image"] = "sha256:00" },
		"no agent":                  func(m map[string]any) { delete(m, "agent") },
		"an unknown agent":          func(m map[string]any) { m["agent"] = "codex" },
		"a model that is a flag":    func(m map[string]any) { m["model"] = "--dangerously-skip-permissions" },
		"no workspace":              func(m map[string]any) { delete(m, "workspace") },
		"no project":                func(m map[string]any) { delete(m, "project") },
		"a workspace climbing":      func(m map[string]any) { m["workspace"] = "../etc" },
		"a dotted workspace":        func(m map[string]any) { m["workspace"] = ".ssh" },
		"a nested workspace":        func(m map[string]any) { m["workspace"] = "a/b" },
		"a workspace option":        func(m map[string]any) { m["workspace"] = "-rf" },
		"an uppercase project":      func(m map[string]any) { m["project"] = "Acme" },
		"an MCP URL off the sink":   func(m map[string]any) { m["mcpUrl"] = "https://evil.example/mcp" },
		"an unknown kind":           func(m map[string]any) { m["kind"] = "shell" },
		"no key":                    func(m map[string]any) { delete(m, "key") },
		"a timeout past four hours": func(m map[string]any) { m["timeoutSeconds"] = 4*3600 + 1 },
		"a prompt with a NUL":       func(m map[string]any) { m["prompt"] = "a\x00b" },
	}
	for name, mutate := range refused {
		m := base()
		mutate(m)
		if err := parse(m); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
	check := map[string]any{"kind": "check", "agent": "gemini", "timeoutSeconds": 60}
	if err := parse(check); err != nil {
		t.Fatalf("a check was refused: %v", err)
	}
	check["prompt"] = "rm -rf ~"
	if err := parse(check); err == nil {
		t.Fatal("a check took a prompt of Lore's")
	}
	delete(check, "prompt")
	check["workspace"] = "triage"
	if err := parse(check); err == nil {
		t.Fatal("a check took a workspace")
	}
}

func TestJobLogReplay(t *testing.T) {
	t.Run("a dropped link holds the log, and a reconnect rewinds", func(t *testing.T) {
		root := t.TempDir()
		log, err := openJobLog(root, "job-1")
		if err != nil {
			t.Fatal(err)
		}
		rec := &frameRecorder{}
		_, _ = log.writer("stdout").Write([]byte("one\n"))
		if log.flush(rec.send, 1, false) {
			t.Fatal("pending after a flush on a live socket")
		}
		rec.mu.Lock()
		rec.down = true
		rec.mu.Unlock()
		_, _ = log.writer("stdout").Write([]byte("two\n"))
		if !log.flush(rec.send, 1, false) {
			t.Fatal("a refused frame was counted as sent")
		}
		rec.mu.Lock()
		rec.down = false
		rec.mu.Unlock()
		// The new connection gets the last frames again, then the rest.
		if log.flush(rec.send, 2, false) {
			t.Fatal("pending after the reconnect's flush")
		}
		if got := rec.text("stdout"); got != "one\ntwo\n" {
			t.Fatalf("Lore holds %q", got)
		}
		if rec.frames[1].Offset != 0 {
			t.Fatalf("the reconnect did not rewind: %+v", rec.frames)
		}
	})

	t.Run("a partial character waits for the rest", func(t *testing.T) {
		log, _ := openJobLog(t.TempDir(), "job-utf8")
		rec := &frameRecorder{}
		euro := []byte("€")
		_, _ = log.writer("stdout").Write(euro[:2])
		log.flush(rec.send, 1, false)
		if len(rec.frames) != 0 {
			t.Fatalf("half a character was sent: %+v", rec.frames)
		}
		_, _ = log.writer("stdout").Write(euro[2:])
		log.flush(rec.send, 1, false)
		if rec.text("stdout") != "€" {
			t.Fatalf("Lore holds %q", rec.text("stdout"))
		}
	})

	t.Run("the spool stops at its cap and says so once", func(t *testing.T) {
		log, _ := openJobLog(t.TempDir(), "job-big")
		rec := &frameRecorder{}
		chunk := []byte(strings.Repeat("x", 1<<20))
		for i := 0; i < 9; i++ {
			_, _ = log.writer("stdout").Write(chunk)
		}
		for log.flush(rec.send, 1, true) {
		}
		if got := len(rec.text("stdout")); got != jobLogCap {
			t.Fatalf("spooled %d bytes, want the %d cap", got, jobLogCap)
		}
		marked := 0
		for _, f := range rec.frames {
			if f.Truncated {
				marked++
			}
		}
		if marked != 1 {
			t.Fatalf("%d frames said truncated, want 1", marked)
		}
	})

	t.Run("a job-run redelivered after its end replays the tail, then re-acks", func(t *testing.T) {
		w := newJobWorld(t)
		w.stub(t, "claude", "#!/bin/sh\necho hello\nexit 2\n")
		w.frames.down = true
		first := w.run("job-offline", w.agentSpec(nil)).last()
		if first.Status != "failed" {
			t.Fatalf("ack = %+v", first)
		}
		w.frames.mu.Lock()
		w.frames.down = false
		w.frames.mu.Unlock()
		// Lore never got the ack, so it redelivers the command.
		rec := &ackRecorder{}
		w.acts.Command(context.Background(), connector.Command{ID: "job-offline", Kind: "job-run"}, rec.send)
		if got := w.frames.text("stdout"); got != "hello\n" {
			t.Fatalf("the replay sent %q", got)
		}
		if last := rec.last(); last.Status != "failed" || last.ExitCode == nil || *last.ExitCode != 2 {
			t.Fatalf("re-ack = %+v", last)
		}
		if _, err := os.Stat(jobLogDir(w.f.root, "job-offline")); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("the replayed spool was kept")
		}
	})
}

func TestJobsInventory(t *testing.T) {
	w := newJobWorld(t)
	w.stub(t, "claude", "#!/bin/sh\necho '2.0.14 (Claude Code)'\n")
	inv, _ := w.acts.Inventory(context.Background())
	if inv.Jobs == nil || inv.Jobs.Runner != "process" || inv.Jobs.ClaudeVersion != "2.0.14" {
		t.Fatalf("jobs block = %+v", inv.Jobs)
	}
	if err := saveJobsConfig(w.f.root, jobsConfig{}); err != nil {
		t.Fatal(err)
	}
	if inv, _ := w.acts.Inventory(context.Background()); inv.Jobs != nil {
		t.Fatalf("a bay without a jobs user reported %+v", inv.Jobs)
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not reached")
		}
		time.Sleep(20 * time.Millisecond)
	}
}
