package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/alepha-dev/bay/internal/runner"
)

/*
The container runner (#Q3999): the same job spec as the process runner, run in
the agent image instead of as a host user. It is what Lore's untrusted-input
rule waits for: the host reports `runner: container` once it is configured
(`bay config jobs --runner container`), and Lore then lets an agent job read
text written outside the team, with the `read` profile.

Each job gets an internal Docker network with no route out (the egress proxy,
#Q3996, is its only way to the world), a fresh workspace volume holding the
clone, and its repository's dependency cache volume. Each step (the clone,
then claude) is a container of its own, hardened by `runner.JobContainer` with
no option to loosen it. The Claude credential is a host-local secret named in
Bay's config, put into the claude step's environment; Lore never sees it.
*/

// jobDocker is what the container runner needs of the daemon.
type jobDocker interface {
	EnsureJobNetwork(name string) error
	RemoveJobNetwork(name string) error
	CreateJobVolume(name string) error
	RemoveJobVolume(name string) error
	RunJob(ctx context.Context, c runner.JobContainer, stdout, stderr io.Writer) (int, error)
	HasRuntime(name string) (bool, error)
	StartEgress(ctx context.Context, s runner.EgressSidecar, out io.Writer) (func(), string, error)
}

type jobContainerRunner struct {
	root   string
	docker func() (jobDocker, error)
	// binary is Bay's own executable as the egress proxy runs it: a Linux
	// build. BAY_EGRESS_BINARY overrides it on a machine whose Bay is not one
	// (a developer's Mac running the daemon tests).
	binary func() (string, error)
}

// egressImage is what the proxy's binary runs in: anything with a libc-free
// /bay works, since Bay is static; busybox is already pulled for the tests.
const egressImage = "busybox:1.37"

const (
	jobMemoryBytes = 4 << 30
	jobPidsLimit   = 1024
)

func newJobContainerRunner(root string) *jobContainerRunner {
	return &jobContainerRunner{root: root,
		docker: func() (jobDocker, error) { return runner.NewDocker("") },
		binary: func() (string, error) {
			if override := os.Getenv("BAY_EGRESS_BINARY"); override != "" {
				return override, nil
			}
			return os.Executable()
		},
	}
}

// jobNames are the Docker names a job uses, derived from its id.
func jobNames(id string) (network, workspace string) {
	short := strings.ReplaceAll(id, "-", "")
	if len(short) > 24 {
		short = short[:24]
	}
	return "bay-job-" + short, "bay-job-" + short
}

// cacheVolume is a repository's dependency cache, shared by its jobs.
func cacheVolume(cloneURL string) string {
	sum := sha256.Sum256([]byte(cloneURL))
	return "bay-job-cache-" + hex.EncodeToString(sum[:])[:16]
}

func (r *jobContainerRunner) run(ctx context.Context, id string, spec jobSpec, log *jobLog) (*int, error) {
	cfg, err := loadJobsConfig(r.root)
	if err != nil {
		return nil, err
	}
	if spec.Image == "" {
		return nil, errors.New("the container runner runs a job in the agent image, and the spec names none")
	}
	docker, err := r.docker()
	if err != nil {
		return nil, fmt.Errorf("the container runner needs Docker: %w", err)
	}
	runtime := ""
	if cfg.GVisor {
		ok, err := docker.HasRuntime("runsc")
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, errors.New("this bay is configured for gVisor, and the Docker daemon has no runsc runtime")
		}
		runtime = "runsc"
	}
	env := []string{
		"HOME=/tmp/home",
		"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
		"DISABLE_AUTOUPDATER=1",
		"CI=1",
		"YARN_CACHE_FOLDER=" + runner.JobCachePath + "/yarn",
		"npm_config_cache=" + runner.JobCachePath + "/npm",
	}
	network, workspace := jobNames(id)
	if err := docker.EnsureJobNetwork(network); err != nil {
		return nil, fmt.Errorf("could not create the job's network: %w", err)
	}
	defer docker.RemoveJobNetwork(network)
	// The job's one way out (#Q3996): its egress proxy, on its list only.
	binary, err := r.binary()
	if err != nil {
		return nil, fmt.Errorf("could not find Bay's binary for the egress proxy: %w", err)
	}
	stop, egressAddr, err := docker.StartEgress(ctx, runner.EgressSidecar{
		Name: network + "-egress", Image: egressImage, Binary: binary,
		Allow: spec.Egress, Network: network,
	}, egressLog{log})
	if err != nil {
		return nil, fmt.Errorf("could not start the job's egress proxy: %w", err)
	}
	defer stop()
	proxy := fmt.Sprintf("http://egress:%d", runner.EgressPort)
	env = append(env, "HTTPS_PROXY="+proxy, "HTTP_PROXY="+proxy,
		"https_proxy="+proxy, "http_proxy="+proxy, "NO_PROXY=", "no_proxy=")
	if err := docker.CreateJobVolume(workspace); err != nil {
		return nil, fmt.Errorf("could not create the job's workspace: %w", err)
	}
	defer docker.RemoveJobVolume(workspace)

	step := func(name string, cmd []string, workDir string, extra []string, cache string) (*int, error) {
		code, err := docker.RunJob(ctx, runner.JobContainer{
			Name: workspace + "-" + name, Image: spec.Image, Cmd: cmd,
			Env: append(append([]string{}, env...), extra...), WorkDir: workDir,
			Workspace: workspace, Cache: cache, Network: network,
			MemoryBytes: jobMemoryBytes, PidsLimit: jobPidsLimit, Runtime: runtime,
			// `egress` by /etc/hosts, not Docker's DNS: see StartEgress.
			Hosts: []string{"egress:" + egressAddr},
		}, log.writer("stdout"), log.writer("stderr"))
		if err != nil {
			return nil, err
		}
		return &code, nil
	}

	credential, err := r.credentialEnv(cfg)
	if err != nil {
		return nil, err
	}
	dir := runner.JobWorkspacePath
	cache := ""
	mcp := ""
	var keyEnv []string
	if spec.Kind == jobKindAgent {
		auth := base64.StdEncoding.EncodeToString([]byte("x-job-key:" + spec.Key))
		keyEnv = []string{
			"GIT_TERMINAL_PROMPT=0",
			"GIT_CONFIG_COUNT=1",
			"GIT_CONFIG_KEY_0=http.extraHeader",
			"GIT_CONFIG_VALUE_0=Authorization: Basic " + auth,
		}
		cache = cacheVolume(spec.Repository.CloneURL)
		if err := docker.CreateJobVolume(cache); err != nil {
			return nil, fmt.Errorf("could not create the dependency cache: %w", err)
		}
		repo := runner.JobWorkspacePath + "/repo"
		code, err := step("clone", []string{"git", "clone", "--quiet", "--branch", spec.Repository.Ref, "--", spec.Repository.CloneURL, repo},
			runner.JobWorkspacePath, keyEnv, "")
		if err != nil {
			return nil, err
		}
		if *code != 0 {
			return nil, fmt.Errorf("git clone of %s at %s exited with status %d", spec.Repository.CloneURL, spec.Repository.Ref, *code)
		}
		raw, err := mcpConfigJSON(spec)
		if err != nil {
			return nil, err
		}
		// A JSON string rather than a file: claude takes either, and the
		// workspace then holds nothing the agent could commit.
		mcp = string(raw)
		dir = repo
	}
	return step("claude", append([]string{"claude"}, claudeArgs(spec, mcp)...), dir, append(keyEnv, credential...), cache)
}

// credentialEnv is the claude step's credential: the host-local secret the
// config names, under its own name.
func (r *jobContainerRunner) credentialEnv(cfg jobsConfig) ([]string, error) {
	if cfg.Credential == "" {
		return nil, nil
	}
	secrets, err := loadHostSecrets(r.root)
	if err != nil {
		return nil, err
	}
	value, ok := secrets[cfg.Credential]
	if !ok {
		return nil, fmt.Errorf("the jobs credential %s is not set: bay secret set %s", cfg.Credential, cfg.Credential)
	}
	return []string{cfg.Credential + "=" + value}, nil
}

// ---------------------------------------------------------------------------
// Host-local secrets: `bay secret set|list|delete`.
// ---------------------------------------------------------------------------

/*
Host-local secrets are values that stay on this machine: the Claude credential
a container job runs with first. Set by the operator from stdin (never argv,
which `ps` shows), stored 0600 under Bay's root, referenced by NAME in Bay's
config, and only the names ever leave: the inventory lists them so Lore can
say which are set, and no wire frame or pull carries a value.
*/
const hostSecretsFile = "host-secrets.json"

var secretNamePattern = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,63}$`)

func loadHostSecrets(root string) (map[string]string, error) {
	raw, err := os.ReadFile(filepath.Join(root, hostSecretsFile))
	if os.IsNotExist(err) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	return out, json.Unmarshal(raw, &out)
}

func saveHostSecrets(root string, secrets map[string]string) error {
	raw, err := json.Marshal(secrets)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	tmp := filepath.Join(root, hostSecretsFile+".tmp")
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(root, hostSecretsFile))
}

// hostSecretNames is what the inventory reports: the names, sorted.
func hostSecretNames(root string) []string {
	secrets, err := loadHostSecrets(root)
	if err != nil {
		return nil
	}
	names := make([]string, 0, len(secrets))
	for name := range secrets {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

const hostSecretUsage = "usage: bay secret (set NAME - | list | delete NAME) [--root DIR]"

// cmdHostSecret is `bay secret set|list|delete`.
func cmdHostSecret(args []string, stdin io.Reader) error {
	root, _ := resolveRoot(args, defaultRoot)
	var positional []string
	for i := 0; i < len(args); i++ {
		if args[i] == "--root" || args[i] == "--control-socket" {
			i++
			continue
		}
		positional = append(positional, args[i])
	}
	if len(positional) == 0 {
		return errors.New(hostSecretUsage)
	}
	secrets, err := loadHostSecrets(root)
	if err != nil {
		return err
	}
	switch positional[0] {
	case "list":
		for _, name := range hostSecretNames(root) {
			fmt.Println(name)
		}
		return nil
	case "delete":
		if len(positional) != 2 {
			return errors.New(hostSecretUsage)
		}
		delete(secrets, positional[1])
		return saveHostSecrets(root, secrets)
	case "set":
		if len(positional) != 3 || positional[2] != "-" {
			return errors.New(hostSecretUsage + " (the value is read from stdin, never from the command line)")
		}
		name := positional[1]
		if !secretNamePattern.MatchString(name) {
			return fmt.Errorf("%q is not a secret name: upper case, digits and underscores, as an environment variable", name)
		}
		raw, err := io.ReadAll(io.LimitReader(stdin, 16<<10))
		if err != nil {
			return err
		}
		value := strings.TrimRight(string(raw), "\r\n")
		if value == "" || strings.ContainsAny(value, "\r\n") {
			return errors.New("the value is empty or spans lines")
		}
		secrets[name] = value
		if err := saveHostSecrets(root, secrets); err != nil {
			return err
		}
		fmt.Printf("secret %s set; its value never leaves this host\n", name)
		return nil
	}
	return errors.New(hostSecretUsage)
}

// egressLog turns the proxy's refusal lines into the job's own log, where
// whoever reads the job sees what it tried to reach (#Q3996).
type egressLog struct{ log *jobLog }

func (e egressLog) Write(p []byte) (int, error) {
	for _, line := range strings.Split(strings.TrimSpace(string(p)), "\n") {
		var refused struct {
			Event, Method, Host string
		}
		if json.Unmarshal([]byte(line), &refused) == nil && refused.Event == "egress.refused" {
			e.log.Note(fmt.Sprintf("egress refused: %s %s is not on this job's list", refused.Method, refused.Host))
		}
	}
	return len(p), nil
}
