package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/alepha-dev/bay/internal/connector"
)

/*
One-shot jobs (#Q3983): `job-run` and `job-cancel`.

A job is not an app. It runs once, to an exit, under a deadline, and its
output streams back as it happens. The first kind is an agent job: an agent
CLI run on a prompt in a workspace directory.

The runner is a host process (folio #F1531, the owner's choice of
2026-11-20): the job runs as a DEDICATED Unix user named in Bay's config
(`bay config jobs --user bay-agent`), never root and never the user Bay runs
as, in a durable workspace under that user's home,
`~/bay-jobs/<project>/<workspace>` (#Q4218): created on first use and kept, so
the first run of a prompt clones what it needs and the next ones pull. Bay
does no git. The agent CLI uses that user's own login, set up by hand by the
host's operator.

⚠️ **A host that runs process jobs does nothing else.** The job has that
user's shell, network and Claude credential; the tool flags Lore sends are
defence in depth, not a sandbox, and the egress list is carried without being
enforced. So such a host serves no production app and holds no other
project's secrets, and Lore refuses untrusted input on it (the inventory says
`runner: process`). A container runner is what lifts that.

What bounds it:
  - the host's switch, `jobsAllowed`, off by default, from the welcome frame;
  - a host-wide limit on running jobs (`bay config jobs --max-jobs`, 1 by
    default), and one job at a time per workspace, held by a lock file under
    Bay's root that a dead Bay releases;
  - a job never takes the machine mutex deploys serialise on, so a long
    agent run never holds a deploy back;
  - the spec is validated before anything runs (jobspec.go), and the command
    line is built here from its fields;
  - a timeout kills the whole process group and acks `timed_out`; a cancel
    does the same and acks `cancelled`.
*/

// jobsConfigFile holds the jobs user, under Bay's root.
const jobsConfigFile = "jobs.json"

type jobsConfig struct {
	User string `json:"user,omitempty"`
	// Runner is `process` (the default) or `container` (#Q3999).
	Runner string `json:"runner,omitempty"`
	// Credential names the host-local secret a container job's claude step
	// runs with, which is also the variable it is set as.
	Credential string `json:"credential,omitempty"`
	// GVisor runs container jobs under runsc, refused when the daemon has
	// none.
	GVisor bool `json:"gvisor,omitempty"`
	// MaxJobs is how many jobs this machine runs at once (#Q4218); zero is
	// one, today's behaviour.
	MaxJobs int `json:"maxJobs,omitempty"`
}

// maxJobsCeiling bounds `--max-jobs`: each job is an agent CLI with its own
// memory, and a host is one machine.
const maxJobsCeiling = 16

// jobsLimit is the number of jobs this machine may run at once.
func (c jobsConfig) jobsLimit() int {
	if c.MaxJobs < 1 {
		return 1
	}
	return c.MaxJobs
}

// runnerKind is what the inventory reports and the executor dispatches on.
func (c jobsConfig) runnerKind() string {
	if c.Runner == "container" {
		return "container"
	}
	return "process"
}

func loadJobsConfig(root string) (jobsConfig, error) {
	var cfg jobsConfig
	raw, err := os.ReadFile(filepath.Join(root, jobsConfigFile))
	if os.IsNotExist(err) {
		return cfg, nil
	}
	if err != nil {
		return cfg, err
	}
	return cfg, json.Unmarshal(raw, &cfg)
}

func saveJobsConfig(root string, cfg jobsConfig) error {
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	tmp := filepath.Join(root, jobsConfigFile+".tmp")
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(root, jobsConfigFile))
}

const jobsUsage = "usage: bay config jobs (--user NAME | --clear) [--runner process|container] [--credential NAME] [--gvisor|--no-gvisor] [--max-jobs N] [--root DIR]"

// cmdConfigJobs is `bay config jobs --user NAME | --clear`: names the Unix
// user process jobs run as. Read by `bay serve` on every job, so it needs no
// restart.
func cmdConfigJobs(args []string) error {
	root, _ := resolveRoot(args, defaultRoot)
	cfg, err := loadJobsConfig(root)
	if err != nil {
		return err
	}
	var name string
	clear, changed := false, false
	for i := 0; i < len(args); i++ {
		value := func() (string, error) {
			if i+1 >= len(args) {
				return "", errors.New(jobsUsage)
			}
			i++
			return args[i], nil
		}
		switch args[i] {
		case "--user":
			if name, err = value(); err != nil {
				return err
			}
		case "--clear":
			clear = true
		case "--runner":
			runner, err := value()
			if err != nil {
				return err
			}
			if runner != "process" && runner != "container" {
				return errors.New("--runner is process or container")
			}
			cfg.Runner, changed = runner, true
		case "--credential":
			credential, err := value()
			if err != nil {
				return err
			}
			if credential != "" && !secretNamePattern.MatchString(credential) {
				return fmt.Errorf("%q is not a secret name", credential)
			}
			cfg.Credential, changed = credential, true
		case "--gvisor":
			cfg.GVisor, changed = true, true
		case "--no-gvisor":
			cfg.GVisor, changed = false, true
		case "--max-jobs":
			raw, err := value()
			if err != nil {
				return err
			}
			n, err := strconv.Atoi(raw)
			if err != nil || n < 1 || n > maxJobsCeiling {
				return fmt.Errorf("--max-jobs is a number from 1 to %d", maxJobsCeiling)
			}
			cfg.MaxJobs, changed = n, true
		case "--root", "--control-socket":
			// Read by resolveRoot, or not needed: the file is read per job.
			i++
		default:
			return errors.New(jobsUsage)
		}
	}
	if clear {
		if name != "" || changed {
			return errors.New(jobsUsage)
		}
		if err := saveJobsConfig(root, jobsConfig{}); err != nil {
			return err
		}
		fmt.Println("jobs config cleared: this bay refuses every job")
		return nil
	}
	if name == "" && !changed {
		return errors.New(jobsUsage)
	}
	if name != "" {
		u, err := user.Lookup(name)
		if err != nil {
			return fmt.Errorf("no Unix user %q on this host: create it first (useradd --create-home %s)", name, name)
		}
		// A dev build in the e2e suite runs jobs as itself (devSelf).
		devSelf := version == "dev" && os.Getenv("BAY_DEV_JOBS_AS_SELF") == "1"
		if err := checkJobsUser(u, os.Getuid()); err != nil && !devSelf {
			return err
		}
		cfg.User = name
	}
	if cfg.User == "" && cfg.runnerKind() == "process" {
		return errors.New("the process runner needs a jobs user: --user NAME")
	}
	if err := saveJobsConfig(root, cfg); err != nil {
		return err
	}
	if cfg.runnerKind() == "container" {
		fmt.Println("jobs run in the agent image, in containers with no host mount, no socket, every capability dropped,")
		fmt.Println("  and a network whose only way out is Bay's egress proxy")
		if cfg.Credential != "" {
			fmt.Printf("  claude runs with the host-local secret %s (bay secret set %s -)\n", cfg.Credential, cfg.Credential)
		}
		return nil
	}
	fmt.Printf("jobs run as %s, %d at a time, in workspaces under ~%s/bay-jobs\n", cfg.User, cfg.jobsLimit(), cfg.User)
	fmt.Printf("  an agent CLI (%s) must be on that user's PATH, signed in by hand as that user (sudo -iu %s)\n", strings.Join(adapterNames(), ", "), cfg.User)
	fmt.Println("  ⚠ a host that runs process jobs should do nothing else: no production app, no other project's secrets")
	return nil
}

// checkJobsUser refuses a jobs user that would give a job more than a
// dedicated account: root, or the user Bay itself runs as.
func checkJobsUser(u *user.User, selfUID int) error {
	uid, err := strconv.Atoi(u.Uid)
	if err != nil {
		return fmt.Errorf("the user %s has no numeric uid", u.Username)
	}
	if uid == 0 {
		return fmt.Errorf("jobs never run as root: name a dedicated user instead of %s", u.Username)
	}
	if uid == selfUID {
		return fmt.Errorf("jobs never run as the user bay runs as (%s): name a dedicated user", u.Username)
	}
	return nil
}

/*
processRunner runs a job as the jobs user, on this host.

The fields after `root` are seams for the tests, which cannot switch users:
`selfUID` is who Bay is, `switchUser` whether it can become another user
(root only), and `allowSameUser` lets a test run the job as itself. In
production they are what the process is, and the checks hold.
*/
type processRunner struct {
	root string
	// selfUID is the uid Bay runs as.
	selfUID int
	// switchUser is whether Bay can run a process as another user: it is
	// root. Without it a job is refused rather than run as Bay.
	switchUser bool
	// testRunAsSelf lets a test run the job as the current user, with
	// nothing switched. Never set outside a test.
	testRunAsSelf bool
	// jobsBase overrides where job directories go (a test's temp dir);
	// empty is `<home>/bay-jobs`.
	jobsBase string
	// pathDirs is where an agent CLI is looked for, for a user's home.
	pathDirs func(home string) []string
	// killGrace is how long a killed job gets between SIGTERM and SIGKILL.
	killGrace time.Duration
}

func newProcessRunner(root string) *processRunner {
	r := &processRunner{root: root, selfUID: os.Getuid(), switchUser: os.Getuid() == 0,
		pathDirs: defaultJobPath, killGrace: 10 * time.Second}
	r.devSelf()
	return r
}

/*
devSelf is the end-to-end suite's way in, and nothing else's: a Bay built
from source (version "dev", never a release) with BAY_DEV_JOBS_AS_SELF=1
runs jobs as the user it runs as, with BAY_DEV_JOBS_PATH searched first for
agent CLIs, and job directories under its own root. Lore's e2e drives a
real Bay with a stub agent this way. A released binary ignores both
variables, so no host can be talked into running jobs as Bay's own user.
*/
func (r *processRunner) devSelf() {
	if version != "dev" || os.Getenv("BAY_DEV_JOBS_AS_SELF") != "1" {
		return
	}
	r.testRunAsSelf = true
	r.jobsBase = filepath.Join(r.root, "dev-jobs")
	if extra := os.Getenv("BAY_DEV_JOBS_PATH"); extra != "" {
		r.pathDirs = func(home string) []string {
			return append([]string{extra}, defaultJobPath(home)...)
		}
	}
}

// defaultJobPath is the PATH a job runs with: where each adapter's
// installers put its CLI for one user (adapters.go), then the system's.
func defaultJobPath(home string) []string {
	var dirs []string
	seen := map[string]bool{}
	for _, name := range adapterNames() {
		for _, rel := range agentAdapters[name].HomeBin {
			dir := filepath.Join(home, rel)
			if !seen[dir] {
				seen[dir] = true
				dirs = append(dirs, dir)
			}
		}
	}
	return append(dirs, "/usr/local/bin", "/usr/bin", "/bin")
}

// jobsUser resolves the configured user and refuses one that may not run a
// job. The reason is what the failed ack says.
func (r *processRunner) jobsUser() (*user.User, error) {
	cfg, err := loadJobsConfig(r.root)
	if err != nil {
		return nil, fmt.Errorf("the jobs config is unreadable: %w", err)
	}
	if cfg.User == "" {
		return nil, errors.New("this bay has no jobs user: its operator runs `bay config jobs --user <name>` with a dedicated Unix user first")
	}
	u, err := user.Lookup(cfg.User)
	if err != nil {
		return nil, fmt.Errorf("the jobs user %q does not exist on this host", cfg.User)
	}
	if r.testRunAsSelf {
		return u, nil
	}
	if err := checkJobsUser(u, r.selfUID); err != nil {
		return nil, err
	}
	if !r.switchUser {
		return nil, fmt.Errorf("bay is not running as root, so it cannot run a job as %s", u.Username)
	}
	return u, nil
}

// lookPath finds a binary in the job's PATH.
func (r *processRunner) lookPath(home, name string) (string, error) {
	for _, dir := range r.pathDirs(home) {
		p := filepath.Join(dir, name)
		if info, err := os.Stat(p); err == nil && info.Mode().IsRegular() && info.Mode()&0o111 != 0 {
			return p, nil
		}
	}
	return "", fmt.Errorf("%s is not on the jobs user's PATH (%s)", name, strings.Join(r.pathDirs(home), ":"))
}

// jobEnv is the whole environment a job runs with: nothing of Bay's.
func (r *processRunner) jobEnv(u *user.User, extra ...string) []string {
	env := []string{
		"HOME=" + u.HomeDir,
		"USER=" + u.Username,
		"LOGNAME=" + u.Username,
		"PATH=" + strings.Join(r.pathDirs(u.HomeDir), ":"),
		"LANG=C.UTF-8",
		// Nobody answers a prompt: git and the like fail rather than wait.
		"GIT_TERMINAL_PROMPT=0",
		"CI=1",
	}
	return append(env, extra...)
}

// command prepares a process as the jobs user, in its own process group so a
// kill reaches everything it started.
func (r *processRunner) command(ctx context.Context, u *user.User, dir, bin string, args []string, env []string) (*exec.Cmd, error) {
	cmd := exec.Command(bin, args...)
	cmd.Dir = dir
	cmd.Env = env
	attr, err := jobSysProcAttr(u, r.switchUser && !r.testRunAsSelf)
	if err != nil {
		return nil, err
	}
	cmd.SysProcAttr = attr
	return cmd, nil
}

// base is where this runner's workspaces live: `<home>/bay-jobs`, or the
// override a test or a dev build sets.
func (r *processRunner) base(u *user.User) string {
	if r.jobsBase != "" {
		return r.jobsBase
	}
	return filepath.Join(u.HomeDir, "bay-jobs")
}

/*
workspaceDir makes sure a job's workspace exists, and answers its path.

The directories are made BY THE JOBS USER (`mkdir -p` run as it), never by
Bay as root: everything under the base is that user's to change, so a
directory Bay created there and then chowned could be a symlink the user
planted, and root would give it whatever the link names.
*/
func (r *processRunner) workspaceDir(ctx context.Context, u *user.User, project, workspace string) (string, error) {
	dir := filepath.Join(r.base(u), project, workspace)
	if err := r.asJobsUser(ctx, u, "mkdir", "-p", "-m", "700", "--", dir); err != nil {
		return "", fmt.Errorf("could not create the workspace %s/%s: %w", project, workspace, err)
	}
	return dir, nil
}

// asJobsUser runs one short system command as the jobs user, for the
// filesystem work Bay does in that user's tree.
func (r *processRunner) asJobsUser(ctx context.Context, u *user.User, name string, args ...string) error {
	bin, err := exec.LookPath(name)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	cmd, err := r.command(ctx, u, u.HomeDir, bin, args, r.jobEnv(u))
	if err != nil {
		return err
	}
	var out strings.Builder
	cmd.Stdout, cmd.Stderr = &out, &out
	code, err := r.wait(ctx, cmd)
	if err != nil {
		return err
	}
	if code != nil && *code != 0 {
		return fmt.Errorf("%s exited with status %d: %s", name, *code, cut(strings.TrimSpace(out.String()), 300))
	}
	return nil
}

/*
run executes one job to its end. It returns the exit code when the process
ran to an exit, and the error that stopped it otherwise; the caller tells a
timeout and a cancel apart by the context.

An agent job runs in its workspace, held for the run by the workspace lock,
and leaves it as the agent left it. A check runs in the jobs user's home.
*/
func (r *processRunner) run(ctx context.Context, id string, spec jobSpec, log *jobLog) (exitCode *int, err error) {
	u, err := r.jobsUser()
	if err != nil {
		return nil, err
	}
	adapter, err := adapterFor(spec.Agent)
	if err != nil {
		return nil, err
	}
	bin, err := r.lookPath(u.HomeDir, adapter.Binary)
	if err != nil {
		return nil, err
	}
	dir := u.HomeDir
	if spec.Kind == jobKindAgent {
		unlock, err := lockWorkspace(r.root, spec.Project, spec.Workspace)
		if err != nil {
			return nil, err
		}
		defer unlock()
		if dir, err = r.workspaceDir(ctx, u, spec.Project, spec.Workspace); err != nil {
			return nil, err
		}
		log.Step("workspace " + spec.Project + "/" + spec.Workspace + " ready")
	}

	run := agentRunOf(spec)
	env := append(r.jobEnv(u), adapter.Env...)
	if spec.Kind == jobKindAgent {
		// The key in the environment only, where the adapter's MCP config
		// expands it: never on a command line `ps` shows.
		env = append(env, jobKeyEnv+"="+spec.Key)
	}
	if adapter.Prepare != nil {
		extra, cleanup, err := adapter.Prepare(run)
		if err != nil {
			return nil, fmt.Errorf("could not prepare the %s run: %w", adapter.Name, err)
		}
		defer cleanup()
		env = append(env, extra...)
	}
	cmd, err := r.command(ctx, u, dir, bin, adapter.Args(run), env)
	if err != nil {
		return nil, err
	}
	cmd.Stdout = log.writer("stdout")
	cmd.Stderr = log.writer("stderr")
	if spec.Kind == jobKindCheck {
		// The check is the version first, then the one-line prompt.
		version, err := r.agentVersion(ctx, u, adapter)
		if err != nil {
			return nil, err
		}
		log.Step(adapter.Name + " " + version)
	}
	log.Step("agent " + adapter.Name + " started")
	code, err := r.wait(ctx, cmd)
	if code != nil {
		log.Step(fmt.Sprintf("agent exited with status %d", *code))
	}
	return code, err
}

// wait starts cmd and waits for its exit, killing its process group when
// ctx ends: SIGTERM, then SIGKILL after the grace.
func (r *processRunner) wait(ctx context.Context, cmd *exec.Cmd) (*int, error) {
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("could not start %s: %w", filepath.Base(cmd.Path), err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		return exitCodeOf(cmd, err)
	case <-ctx.Done():
		killGroup(cmd.Process.Pid, false)
		select {
		case <-done:
		case <-time.After(r.killGrace):
			killGroup(cmd.Process.Pid, true)
			<-done
		}
		return nil, ctx.Err()
	}
}

func exitCodeOf(cmd *exec.Cmd, err error) (*int, error) {
	if cmd.ProcessState != nil {
		code := cmd.ProcessState.ExitCode()
		if code >= 0 {
			return &code, nil
		}
	}
	if err == nil {
		zero := 0
		return &zero, nil
	}
	return nil, err
}

// agentVersion asks an agent CLI for its version, as the jobs user: the first
// word of what its version command prints that holds a digit. Cached by the
// inventory's caller.
func (r *processRunner) agentVersion(ctx context.Context, u *user.User, adapter agentAdapter) (string, error) {
	bin, err := r.lookPath(u.HomeDir, adapter.Binary)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	cmd, err := r.command(ctx, u, u.HomeDir, bin, adapter.VersionArgs, append(r.jobEnv(u), adapter.Env...))
	if err != nil {
		return "", err
	}
	var out strings.Builder
	cmd.Stdout = &out
	code, err := r.wait(ctx, cmd)
	if err != nil {
		return "", err
	}
	if code != nil && *code != 0 {
		return "", fmt.Errorf("%s %s exited with status %d", adapter.Binary, strings.Join(adapter.VersionArgs, " "), *code)
	}
	for _, field := range strings.Fields(out.String()) {
		if strings.ContainsAny(field, "0123456789") {
			return cut(field, 100), nil
		}
	}
	return "", fmt.Errorf("%s %s printed no version", adapter.Binary, strings.Join(adapter.VersionArgs, " "))
}

// ---------------------------------------------------------------------------
// The executor's side.
// ---------------------------------------------------------------------------

// jobs is the executor's state for one-shot jobs: the ones running now, and
// the agent version the inventory reports.
type jobs struct {
	runner *processRunner
	// container is the container runner (#Q3999), used when the config says.
	container *jobContainerRunner

	mu      sync.Mutex
	running map[string]context.CancelCauseFunc

	versionMu sync.Mutex
	version   string
	versionAt time.Time
	versionEr string
}

// jobSecond is what a spec's timeoutSeconds counts in: a second, and a
// millisecond in the tests, which cannot wait out a real deadline.
var jobSecond = time.Second

// errJobCancelled is the cause a `job-cancel` stops a job with.
var errJobCancelled = errors.New("cancelled by a job-cancel")

func newJobs(root string) *jobs {
	return &jobs{runner: newProcessRunner(root), container: newJobContainerRunner(root),
		running: map[string]context.CancelCauseFunc{}}
}

// run executes a job on the runner the config names.
func (j *jobs) run(ctx context.Context, id string, spec jobSpec, log *jobLog) (*int, error) {
	cfg, err := loadJobsConfig(j.runner.root)
	if err != nil {
		return nil, err
	}
	if cfg.runnerKind() == "container" {
		return j.container.run(ctx, id, spec, log)
	}
	return j.runner.run(ctx, id, spec, log)
}

// claim takes one of the machine's job slots, of which there are `limit`.
func (j *jobs) claim(id string, cancel context.CancelCauseFunc, limit int) bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	if len(j.running) >= limit {
		return false
	}
	j.running[id] = cancel
	return true
}

func (j *jobs) release(id string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	delete(j.running, id)
}

// runningIDs is the jobs running now, sorted, joined by commas: what the
// inventory's `running` says.
func (j *jobs) runningIDs() string {
	if j == nil {
		return ""
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	ids := make([]string, 0, len(j.running))
	for id := range j.running {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return strings.Join(ids, ",")
}

func (j *jobs) stop(id string) bool {
	if j == nil {
		return false
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	cancel, ok := j.running[id]
	if !ok {
		return false
	}
	cancel(errJobCancelled)
	return true
}

// inventory is the jobs block of the inventory, nil without a jobs user.
// Nil-safe, like every read of the slot: an executor built without
// newActions (a CLI path, a test) has no job runner and reports none.
func (j *jobs) inventory(ctx context.Context) *connector.InventoryJobs {
	if j == nil {
		return nil
	}
	cfg, err := loadJobsConfig(j.runner.root)
	if err != nil || (cfg.User == "" && cfg.runnerKind() == "process") {
		return nil
	}
	out := &connector.InventoryJobs{Runner: cfg.runnerKind(), User: cfg.User, Running: j.runningIDs(),
		Secrets: hostSecretNames(j.runner.root)}
	if cfg.runnerKind() == "container" {
		// The CLI is the agent image's, pinned by digest per job: its version
		// is what the check job reports, not a reading of this host.
		return out
	}
	j.versionMu.Lock()
	defer j.versionMu.Unlock()
	if time.Since(j.versionAt) > 10*time.Minute {
		j.version, j.versionEr = "", ""
		// The inventory's one version field until it lists every tool
		// (#Q4220).
		u, err := j.runner.jobsUser()
		var v string
		if err == nil {
			v, err = j.runner.agentVersion(ctx, u, agentAdapters["claude"])
		}
		if err != nil {
			j.versionEr = cut(err.Error(), 500)
		} else {
			j.version = v
		}
		j.versionAt = time.Now()
	}
	out.ClaudeVersion, out.ClaudeError = j.version, j.versionEr
	return out
}

/*
jobRun pulls the spec, runs the job and streams its log, outside the machine
mutex. The terminal status is `done` (exit 0), `failed` (a refusal or another
exit), `timed_out` or `cancelled`.
*/
func (a *actions) jobRun(ctx context.Context, cmd connector.Command) (status, step, reason string, exit *int) {
	if !a.latestWelcome().JobsAllowed {
		return "failed", "", "this host does not run jobs: its home project has not allowed them, and the welcome frame said so", nil
	}
	if a.jobs == nil {
		return "failed", "", "this bay process has no job runner", nil
	}
	cfg, ok, err := connector.NewStore(a.s.root).Load()
	if err != nil || !ok {
		return "failed", "", "no connector is configured on this bay, so there is nothing to pull from", nil
	}
	jobsCfg, err := loadJobsConfig(a.s.root)
	if err != nil {
		return "failed", "", "the jobs config is unreadable: " + err.Error(), nil
	}
	jobCtx, cancel := context.WithCancelCause(context.WithoutCancel(ctx))
	defer cancel(nil)
	if limit := jobsCfg.jobsLimit(); !a.jobs.claim(cmd.ID, cancel, limit) {
		return "failed", "", fmt.Sprintf("this bay already runs %d job(s) (%s), its limit: bay config jobs --max-jobs raises it", limit, a.jobs.runningIDs()), nil
	}
	defer a.jobs.release(cmd.ID)
	if a.kick != nil {
		// The inventory says which job runs.
		a.kick()
	}

	client := &http.Client{Timeout: connector.FetchTimeout}
	raw, err := connector.PullJobSpec(ctx, client, cfg, cmd.ID)
	if err != nil {
		return "failed", "pulling", "could not pull the job spec: " + err.Error(), nil
	}
	spec, err := parseJobSpec(raw, cfg.Sink)
	if err != nil {
		return "failed", "validating", err.Error(), nil
	}
	// A spool left by an earlier run of this id (a Bay that died mid-job)
	// is not this run's log.
	_ = os.RemoveAll(jobLogDir(a.s.root, cmd.ID))
	log, err := openJobLog(a.s.root, cmd.ID)
	if err != nil {
		return "failed", "", "could not open the job's log spool: " + err.Error(), nil
	}

	runCtx, stopDeadline := context.WithTimeoutCause(jobCtx, time.Duration(spec.TimeoutSeconds)*jobSecond, context.DeadlineExceeded)
	defer stopDeadline()
	streamed := make(chan struct{})
	go func() {
		defer close(streamed)
		a.streamJobLog(runCtx, log)
	}()

	exit, runErr := a.jobs.run(runCtx, cmd.ID, spec, log)
	cause := context.Cause(runCtx)
	switch {
	case errors.Is(cause, errJobCancelled):
		status, reason = connector.AckCancelled, "cancelled by a job-cancel; the process group was killed"
	case errors.Is(cause, context.DeadlineExceeded):
		status, reason = connector.AckTimedOut, fmt.Sprintf("the job ran past its %d s timeout; the process group was killed", spec.TimeoutSeconds)
	case runErr != nil:
		status, reason = "failed", runErr.Error()
	case exit != nil && *exit == 0:
		status = "done"
	default:
		status = "failed"
		reason = fmt.Sprintf("the agent exited with status %d", *exit)
		if tail := strings.TrimSpace(log.stderrTail(400)); tail != "" {
			reason += ": " + tail
		}
	}
	if status != "done" && exit == nil {
		// Said in the log too, where somebody reading it looks first.
		log.Note(reason)
	}
	stopDeadline()
	<-streamed
	a.drainJobLog(ctx, log, 5*time.Second)
	return status, "", reason, exit
}

// streamJobLog flushes the spool every jobFlushEvery until ctx ends.
func (a *actions) streamJobLog(ctx context.Context, log *jobLog) {
	ticker := time.NewTicker(jobFlushEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if a.sendFrame != nil {
				log.flush(a.sendFrame, a.connGeneration(), false)
			}
		}
	}
}

/*
drainJobLog sends what is left of a finished job's log, for up to `wait`, and
removes the spool once all of it went out. A spool that could not drain (the
socket is down) stays on disk: the job-run's redelivery replays it before it
re-acks, since Lore redelivers a command whose terminal ack it never got.
*/
func (a *actions) drainJobLog(ctx context.Context, log *jobLog, wait time.Duration) {
	if a.sendFrame == nil {
		log.remove()
		return
	}
	deadline := time.Now().Add(wait)
	for {
		if !log.flush(a.sendFrame, a.connGeneration(), true) {
			log.remove()
			return
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// replayJobLog drains a spool a redelivered job-run left behind, if any.
func (a *actions) replayJobLog(ctx context.Context, id string) {
	if _, err := os.Stat(jobLogDir(a.s.root, id)); err != nil {
		return
	}
	log, err := openJobLog(a.s.root, id)
	if err != nil {
		return
	}
	a.drainJobLog(ctx, log, 10*time.Second)
}

func (a *actions) connGeneration() uint64 {
	if a.generation == nil {
		return 0
	}
	return a.generation()
}

// jobCancel stops the job a `job-cancel` names. Its own ack is `done` once
// the kill is sent; the job's `job-run` acks `cancelled` when it has ended.
func (a *actions) jobCancel(cmd connector.Command) (status, step, reason string) {
	if cmd.JobCommandID == "" {
		return "failed", "", "a job-cancel names the job-run it stops"
	}
	if a.jobs.stop(cmd.JobCommandID) {
		return "done", "", "the job's process group is being killed"
	}
	if prior, ok := a.outcomes.Get(cmd.JobCommandID); ok {
		return "done", "", "the job had already ended (" + prior.Status + ")"
	}
	return "done", "", "no such job runs on this bay"
}

// cut truncates to n runes.
func cut(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n-1]) + "…"
}
