package runner

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

/*
Docker supervises apps as containers, one per app instance.

It replaces systemd as the supervisor (epic E73 in the Bay project): the same
Runner contract, with Docker holding the restart loop, the memory and CPU
ceilings and the log, and the container boundary taking over from the per-app
unix user and the systemd sandbox as the isolation.

Containers outlive Bay on purpose, as units did: Bay is the reverse proxy, and
an upgrade or a crash of Bay must not take a single app down with it.
*/
type Docker struct {
	api *dockerAPI
}

/*
Container is what the Docker runner needs beyond Spec, carried in Spec.Sandbox
the way the systemd backend carries a Sandbox.

The command is Spec.Runtime then Spec.Entry, run inside Image. Runtime is
therefore a command name the image provides (`node`, `bun`), not a path on the
host.
*/
type Container struct {
	// Image is the runtime image, by digest in production
	// (`node:26-slim@sha256:...`) so the same deploy always runs the same bytes.
	Image string
	// WorkDir is the working directory inside the container, where the release
	// is mounted.
	WorkDir string
	// Mounts are the only host paths the container sees.
	Mounts []Mount
	// Port is the app's port inside the container, published on the host's
	// loopback only (127.0.0.1:Port), which is where the proxy and the health
	// probe already look. Zero publishes nothing.
	Port int
	// MemoryBytes is the hard memory ceiling. Zero means unlimited.
	MemoryBytes int64
	// PidsLimit caps processes and threads, systemd's TasksMax. Zero means the
	// daemon's default.
	PidsLimit int64
	// NanoCPUs is the CPU ceiling in billionths of a core, so 2e9 is two full
	// cores: systemd's CPUQuota of "200%". Zero means unlimited.
	NanoCPUs int64
	// StopGrace is how long the app gets between SIGTERM and SIGKILL. Zero
	// means defaultStopGrace, never Docker's own 10 seconds: an Alepha app
	// waits up to 10 seconds for in-flight requests before its pools close and
	// its telemetry flushes, so 10 seconds is the floor, not the budget.
	StopGrace time.Duration
}

// Mount is one bind mount from the host into the container.
type Mount struct {
	Source   string
	Target   string
	ReadOnly bool
}

// dockerKeyLabel names the Bay instance a container belongs to, so a container
// on the host can always be traced back to the app that owns it.
const dockerKeyLabel = "dev.alepha.bay.key"

// Timeouts for calls to the daemon. A pull is the one call that legitimately
// takes minutes; everything else answers in milliseconds or is broken.
const (
	dockerCallTimeout = 30 * time.Second
	dockerPullTimeout = 10 * time.Minute
)

/*
NewDocker connects to the daemon's unix socket, DOCKER_HOST's or the default
when `socket` is empty, and checks that it answers.

Failing here rather than at the first deploy: a Bay that starts without a
reachable Docker has nothing it can run, and saying so at boot is the one
moment the operator is looking.
*/
func NewDocker(socket string) (*Docker, error) {
	if socket == "" {
		var err error
		if socket, err = dockerSocket(); err != nil {
			return nil, err
		}
	}
	d := &Docker{api: newDockerAPI(socket)}
	if _, err := d.api.raw("GET", "/_ping", nil, nil, dockerCallTimeout); err != nil {
		return nil, fmt.Errorf("docker is not reachable at %s: %w", socket, err)
	}
	return d, nil
}

/*
Start replaces the app's container with a fresh one built from the spec, and
returns once it is running.

Like the other runners it does NOT wait for readiness: that is the health
probe's job. A container already present is stopped with its grace first, then
removed, so a Start on a running app is a graceful restart, as `systemctl
restart` was, never a kill.
*/
func (d *Docker) Start(spec Spec) error {
	c, ok := spec.Sandbox.(Container)
	if !ok {
		return fmt.Errorf("docker runner needs a Container for %s", spec.Key)
	}
	if c.Image == "" {
		return fmt.Errorf("docker runner needs an image for %s", spec.Key)
	}
	name := unitName(spec.Key)

	if err := d.Stop(spec.Key, stopGraceOfContainer(c)); err != nil {
		return err
	}
	if err := d.removeContainer(name); err != nil {
		return err
	}
	if err := d.EnsureImage(c.Image); err != nil {
		return err
	}
	body := createBody(spec, c)
	if err := d.api.do("POST", "/containers/create", url.Values{"name": {name}}, body, nil, dockerCallTimeout); err != nil {
		return fmt.Errorf("create %s: %w", name, err)
	}
	if err := d.api.do("POST", "/containers/"+name+"/start", nil, nil, nil, dockerCallTimeout); err != nil {
		return fmt.Errorf("start %s: %w", name, err)
	}
	return nil
}

/*
createBody renders the container definition.

Two choices carry the supervisor's semantics:

  - RestartPolicy `always`. Docker restarts the app when it exits, and brings
    back a container that was stopped by hand when the daemon restarts, which
    is exactly what an enabled systemd unit did across a reboot. Park is what
    turns that off (see Park), never Stop, for the reason the Runner interface
    gives.
  - Init. The runtime is not written to be PID 1: without an init it ignores
    SIGTERM's default action and reaps nothing, so a stop would always run out
    the grace and end in SIGKILL.
*/
func createBody(spec Spec, c Container) map[string]any {
	env := make([]string, 0, len(spec.Env))
	for k, v := range spec.Env {
		env = append(env, k+"="+v)
	}
	// Sorted, so the same spec renders the same body and a diff of two
	// definitions shows what changed rather than map order.
	sort.Strings(env)

	mounts := make([]map[string]any, 0, len(c.Mounts))
	for _, m := range c.Mounts {
		mounts = append(mounts, map[string]any{
			"Type":     "bind",
			"Source":   m.Source,
			"Target":   m.Target,
			"ReadOnly": m.ReadOnly,
		})
	}

	host := map[string]any{
		"Mounts":        mounts,
		"RestartPolicy": map[string]any{"Name": "always"},
		"Init":          true,
	}
	if c.MemoryBytes > 0 {
		host["Memory"] = c.MemoryBytes
	}
	if c.PidsLimit > 0 {
		host["PidsLimit"] = c.PidsLimit
	}
	if c.NanoCPUs > 0 {
		host["NanoCpus"] = c.NanoCPUs
	}

	body := map[string]any{
		"Image":       c.Image,
		"Cmd":         []string{spec.Runtime, spec.Entry},
		"WorkingDir":  c.WorkDir,
		"Env":         env,
		"Labels":      map[string]string{dockerKeyLabel: spec.Key},
		"StopTimeout": int(stopGraceOfContainer(c).Seconds()),
		"HostConfig":  host,
	}
	if c.Port > 0 {
		port := strconv.Itoa(c.Port) + "/tcp"
		body["ExposedPorts"] = map[string]any{port: map[string]any{}}
		// Loopback only. Docker publishes on every interface by default, and
		// its iptables rules are evaluated before the host firewall's, so a
		// default binding would put the app on the internet past UFW, beside
		// Bay's proxy rather than behind it.
		host["PortBindings"] = map[string]any{
			port: []map[string]string{{"HostIp": "127.0.0.1", "HostPort": strconv.Itoa(c.Port)}},
		}
	}
	return body
}

func stopGraceOfContainer(c Container) time.Duration {
	if c.StopGrace > 0 {
		return c.StopGrace
	}
	return defaultStopGrace
}

/*
EnsureImage pulls the image when the daemon does not have it.

An image already present is never pulled again: production references carry a
digest, so the local copy is the right bytes by definition, and a pull on every
start would make a restart depend on a registry being up.
*/
func (d *Docker) EnsureImage(image string) error {
	err := d.api.do("GET", "/images/"+image+"/json", nil, nil, nil, dockerCallTimeout)
	if err == nil {
		return nil
	}
	if !isStatus(err, 404) {
		return fmt.Errorf("inspect image %s: %w", image, err)
	}
	from, tag := splitImageRef(image)
	out, err := d.api.raw("POST", "/images/create", url.Values{"fromImage": {from}, "tag": {tag}}, nil, dockerPullTimeout)
	if err != nil {
		return fmt.Errorf("pull %s: %w", image, err)
	}
	// A pull answers 200 and then streams its progress, so a failure halfway
	// (a missing manifest for this architecture, a registry refusing) arrives
	// as an `error` line inside a successful response.
	if msg := pullError(out); msg != "" {
		return fmt.Errorf("pull %s: %s", image, msg)
	}
	return nil
}

/*
ResolveDigest pulls a tag and answers the reference it now points to,
`tag@sha256:...`.

Always pulls, unlike EnsureImage: the question is what the tag means TODAY,
which is how `bay runtimes update` picks up a patched base image. The answer
is the digest the registry served, read back from the image's RepoDigests, so
it is pullable by digest from then on.
*/
func (d *Docker) ResolveDigest(tag string) (string, error) {
	from, version := splitImageRef(tag)
	out, err := d.api.raw("POST", "/images/create", url.Values{"fromImage": {from}, "tag": {version}}, nil, dockerPullTimeout)
	if err != nil {
		return "", fmt.Errorf("pull %s: %w", tag, err)
	}
	if msg := pullError(out); msg != "" {
		return "", fmt.Errorf("pull %s: %s", tag, msg)
	}
	var info struct {
		RepoDigests []string `json:"RepoDigests"`
	}
	if err := d.api.do("GET", "/images/"+tag+"/json", nil, nil, &info, dockerCallTimeout); err != nil {
		return "", fmt.Errorf("inspect %s: %w", tag, err)
	}
	for _, repoDigest := range info.RepoDigests {
		repo, digest, ok := strings.Cut(repoDigest, "@")
		if ok && sameRepo(repo, from) {
			return tag + "@" + digest, nil
		}
	}
	return "", fmt.Errorf("%s has no registry digest after a pull", tag)
}

/*
sameRepo compares two repository names the way the daemon spells them: Docker
Hub's official images may come back as `node` or `docker.io/library/node`.
*/
func sameRepo(a, b string) bool {
	norm := func(r string) string {
		r = strings.TrimPrefix(r, "docker.io/")
		return strings.TrimPrefix(r, "library/")
	}
	return norm(a) == norm(b)
}

/*
splitImageRef separates a reference into the `fromImage` and `tag` the pull
endpoint takes.

The tag is never left empty. An empty tag asks the daemon for EVERY tag of the
repository, which on `node` is thousands of images and fills the disk.
*/
func splitImageRef(ref string) (string, string) {
	if name, digest, ok := strings.Cut(ref, "@"); ok {
		// `node:26-slim@sha256:...`: the digest is what is pulled, and the tag
		// beside it is a label for humans.
		if i := strings.LastIndex(name, ":"); i > strings.LastIndex(name, "/") {
			name = name[:i]
		}
		return name, digest
	}
	if i := strings.LastIndex(ref, ":"); i > strings.LastIndex(ref, "/") {
		return ref[:i], ref[i+1:]
	}
	return ref, "latest"
}

// pullError finds the first error line in a pull's progress stream.
func pullError(stream []byte) string {
	sc := bufio.NewScanner(bytes.NewReader(stream))
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		var line struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(sc.Bytes(), &line) == nil && line.Error != "" {
			return line.Error
		}
	}
	return ""
}

func (d *Docker) removeContainer(name string) error {
	err := d.api.do("DELETE", "/containers/"+name, url.Values{"force": {"true"}}, nil, nil, dockerCallTimeout)
	if err != nil && !isStatus(err, 404) {
		return fmt.Errorf("remove %s: %w", name, err)
	}
	return nil
}

/*
Stop stops the container, with SIGTERM then SIGKILL after `grace`.

Docker holds the clock, from the `t` parameter, and the call returns when the
container is down. The bound on the call is longer, for the same reason as the
systemd backend's: a daemon not doing what it was asked must not wedge a
deploy halfway. No container, or one already stopped, is not a failure: the
first deploy has nothing to stop.
*/
func (d *Docker) Stop(key string, grace time.Duration) error {
	name := unitName(key)
	query := url.Values{"t": {strconv.Itoa(int(grace.Seconds()))}}
	err := d.api.do("POST", "/containers/"+name+"/stop", query, nil, nil, grace+stopCallMargin)
	if err != nil && !isStatus(err, 404) && !isStatus(err, 304) {
		return fmt.Errorf("stop %s: %w", key, err)
	}
	return nil
}

/*
Park stops the container and switches its restart policy off, so it stays down
across a daemon restart or a reboot until a Start recreates it.

The order matters: the policy is changed after the stop has returned, so a
container that dies during its own shutdown is not restarted by a policy that
was about to be removed anyway.
*/
func (d *Docker) Park(key string, grace time.Duration) error {
	if err := d.Stop(key, grace); err != nil {
		return err
	}
	name := unitName(key)
	body := map[string]any{"RestartPolicy": map[string]any{"Name": "no"}}
	err := d.api.do("POST", "/containers/"+name+"/update", nil, body, nil, dockerCallTimeout)
	if err != nil && !isStatus(err, 404) {
		return fmt.Errorf("park %s: %w", key, err)
	}
	return nil
}

/*
Remove deletes the container.

`purge` has nothing to gate here: the per-app unix user it guarded on systemd
does not exist, and the app's data lives in bind mounts under its instance
directory, which the caller deletes or keeps. The container itself never holds
anything worth keeping.
*/
func (d *Docker) Remove(key string, _ bool) error {
	return d.removeContainer(unitName(key))
}

// inspect is the subset of GET /containers/{name}/json the runner reads.
type inspect struct {
	RestartCount int `json:"RestartCount"`
	State        struct {
		Status     string `json:"Status"`
		Running    bool   `json:"Running"`
		Restarting bool   `json:"Restarting"`
		OOMKilled  bool   `json:"OOMKilled"`
		ExitCode   int    `json:"ExitCode"`
		Pid        int    `json:"Pid"`
		StartedAt  string `json:"StartedAt"`
	} `json:"State"`
}

// inspectContainer answers false when there is no such container.
func (d *Docker) inspectContainer(key string) (inspect, bool, error) {
	var out inspect
	err := d.api.do("GET", "/containers/"+unitName(key)+"/json", nil, nil, &out, dockerCallTimeout)
	if isStatus(err, 404) {
		return out, false, nil
	}
	if err != nil {
		return out, false, err
	}
	return out, true, nil
}

// Running reports whether the container is up.
func (d *Docker) Running(key string) bool {
	info, found, err := d.inspectContainer(key)
	return err == nil && found && info.State.Running && !info.State.Restarting
}

/*
State reports the container in systemd's words, because those are what the
estate wire carries to Lore and what the console already knows how to say:
`active`, `activating`, `deactivating`, `inactive`, `failed`.

An exit by SIGTERM (143) or with 0 is a clean stop, `inactive`; any other exit,
an OOM kill included, is `failed`, as systemd called a unit that died or ran out
its stop timeout. Empty when the daemon cannot say.
*/
func (d *Docker) State(key string) string {
	info, found, err := d.inspectContainer(key)
	if err != nil {
		return ""
	}
	if !found {
		return "inactive"
	}
	return containerState(info)
}

func containerState(info inspect) string {
	switch info.State.Status {
	case "running":
		if info.State.Restarting {
			return "activating"
		}
		return "active"
	case "restarting":
		return "activating"
	case "removing":
		return "deactivating"
	case "exited", "dead":
		if info.State.OOMKilled || (info.State.ExitCode != 0 && info.State.ExitCode != 143) {
			return "failed"
		}
		return "inactive"
	default:
		// "created" and "paused": nothing is serving.
		return "inactive"
	}
}

// stats is the subset of the one-shot stats answer the runner reads.
type stats struct {
	MemoryStats struct {
		Usage int64 `json:"usage"`
	} `json:"memory_stats"`
	CPUStats struct {
		CPUUsage struct {
			TotalUsage int64 `json:"total_usage"`
		} `json:"cpu_usage"`
	} `json:"cpu_stats"`
	PidsStats struct {
		Current int `json:"current"`
	} `json:"pids_stats"`
}

/*
Usage reads the container's cgroup through the daemon: memory charge, CPU time,
tasks, plus the restart count and start time from its inspect.

A container that is not running reports nothing, like a unit with no main
process: zeros would read as a measurement.
*/
func (d *Docker) Usage(key string) (Usage, bool) {
	info, found, err := d.inspectContainer(key)
	if err != nil || !found || !info.State.Running {
		return Usage{}, false
	}
	var s stats
	query := url.Values{"stream": {"false"}, "one-shot": {"true"}}
	if err := d.api.do("GET", "/containers/"+unitName(key)+"/stats", query, nil, &s, dockerCallTimeout); err != nil {
		return Usage{}, false
	}
	u := Usage{
		MemoryBytes: s.MemoryStats.Usage,
		CPUSeconds:  float64(s.CPUStats.CPUUsage.TotalUsage) / 1e9,
		Tasks:       s.PidsStats.Current,
		Restarts:    info.RestartCount,
		PID:         info.State.Pid,
	}
	if started, err := time.Parse(time.RFC3339Nano, info.State.StartedAt); err == nil {
		u.StartedAt = started
	}
	return u, true
}

/*
Logs reads the last n lines the container wrote, stdout and stderr together in
the order they were written, which is what keeps a stack trace next to the
request that caused it.

Asked with timestamps, so a line that carries no time of its own still gets
Docker's.
*/
func (d *Docker) Logs(key string, n int) ([]LogLine, bool, error) {
	if _, found, err := d.inspectContainer(key); err != nil || !found {
		return nil, false, err
	}
	query := url.Values{
		"stdout":     {"1"},
		"stderr":     {"1"},
		"timestamps": {"1"},
		"tail":       {strconv.Itoa(n)},
	}
	raw, err := d.api.raw("GET", "/containers/"+unitName(key)+"/logs", query, nil, dockerCallTimeout)
	if err != nil {
		return nil, true, fmt.Errorf("logs for %s: %w", key, err)
	}
	return parseDockerLogs(raw), true, nil
}

/*
parseDockerLogs reads the Engine's multiplexed log stream.

A container started without a TTY, which is every container Bay starts, frames
its output: an 8-byte header (stream id, three zero bytes, a big-endian
length) before each chunk. A chunk is not a line, so the chunks are joined and
then split on newlines.
*/
func parseDockerLogs(stream []byte) []LogLine {
	var joined bytes.Buffer
	for len(stream) >= 8 {
		size := int(binary.BigEndian.Uint32(stream[4:8]))
		stream = stream[8:]
		if size > len(stream) {
			size = len(stream)
		}
		joined.Write(stream[:size])
		stream = stream[size:]
	}
	var out []LogLine
	for _, line := range strings.Split(joined.String(), "\n") {
		if line == "" {
			continue
		}
		stamp, text, _ := strings.Cut(line, " ")
		parsed := ParseLogLine(text)
		if parsed.At.IsZero() {
			if at, err := time.Parse(time.RFC3339Nano, stamp); err == nil {
				parsed.At = at
			}
		}
		out = append(out, parsed)
	}
	return out
}

// DaemonInfo is what `bay doctor` asks of the daemon.
type DaemonInfo struct {
	Version       string // the Engine's release, "29.7.2"
	APIVersion    string // the newest Engine API it speaks, "1.52"
	CgroupVersion string // "2" or "1"
}

// Info reads the daemon's version and cgroup version.
func (d *Docker) Info() (DaemonInfo, error) {
	var v struct {
		Version    string `json:"Version"`
		APIVersion string `json:"ApiVersion"`
	}
	if err := d.api.do("GET", "/version", nil, nil, &v, dockerCallTimeout); err != nil {
		return DaemonInfo{}, err
	}
	var i struct {
		CgroupVersion string `json:"CgroupVersion"`
	}
	if err := d.api.do("GET", "/info", nil, nil, &i, dockerCallTimeout); err != nil {
		return DaemonInfo{}, err
	}
	return DaemonInfo{Version: v.Version, APIVersion: v.APIVersion, CgroupVersion: i.CgroupVersion}, nil
}

// MinDockerAPI is the oldest Engine API Bay works with, without its "v".
const MinDockerAPI = "1.44"

// StopAll is a no-op: containers outlive Bay on purpose, as units did.
func (d *Docker) StopAll(time.Duration) {}
