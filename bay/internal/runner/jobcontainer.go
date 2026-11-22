package runner

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

/*
JobContainer is one step of a one-shot job run in a container (#Q3999): the
same job spec the process runner reads, run in the agent image with nothing of
the host in reach.

Hardened by construction, with no field to loosen it: a non-root user, no
Docker socket and no bind mount at all (only the job's workspace volume and
its dependency cache volume), every capability dropped, no-new-privileges, a
read-only root filesystem with a /tmp tmpfs, memory and pids limits. Its
network is the one the caller names, which the egress proxy (#Q3996) makes
the only way out.
*/
type JobContainer struct {
	// Name is the container's name, unique per job step.
	Name string
	// Image is the agent image, by digest.
	Image string
	// Cmd is the argv, built by Bay; never a shell string.
	Cmd []string
	Env []string
	// WorkDir is where Cmd runs, inside the workspace.
	WorkDir string
	// Workspace is the job's volume, mounted at JobWorkspacePath.
	Workspace string
	// Cache is the repository's dependency cache volume, mounted at
	// JobCachePath; empty for none.
	Cache string
	// Network is the job's network; empty is none at all.
	Network string
	// User runs Cmd; the agent image's non-root user by default.
	User        string
	MemoryBytes int64
	PidsLimit   int64
	// Runtime is the OCI runtime, `runsc` for gVisor; empty is the daemon's.
	Runtime string
	// Hosts are `name:ip` lines for the container's /etc/hosts: the egress
	// proxy's, so a step finds it without Docker's embedded DNS, which a
	// gVisor sandbox cannot reach.
	Hosts []string
}

const (
	// JobWorkspacePath is where a job's workspace volume is mounted.
	JobWorkspacePath = "/work"
	// JobCachePath is where its dependency cache volume is mounted.
	JobCachePath = "/cache"
	// JobUser is the agent image's non-root user.
	JobUser = "1000:1000"
	// jobLabel marks every container and volume a job creates, so a sweep
	// can find what a crash left.
	jobLabel = "dev.alepha.bay.job"
)

// jobCreateBody is the container a job step runs in. A function of its own
// so the tests read the hardening without a daemon.
func jobCreateBody(c JobContainer) map[string]any {
	mounts := []map[string]any{{
		"Type": "volume", "Source": c.Workspace, "Target": JobWorkspacePath,
	}}
	if c.Cache != "" {
		mounts = append(mounts, map[string]any{
			"Type": "volume", "Source": c.Cache, "Target": JobCachePath,
		})
	}
	user := c.User
	if user == "" {
		user = JobUser
	}
	network := c.Network
	if network == "" {
		network = "none"
	}
	host := map[string]any{
		"Mounts":         mounts,
		"CapDrop":        []string{"ALL"},
		"SecurityOpt":    []string{"no-new-privileges:true"},
		"ReadonlyRootfs": true,
		"Tmpfs":          map[string]string{"/tmp": "rw,nosuid,nodev,size=512m"},
		"NetworkMode":    network,
		"Init":           true,
		"LogConfig":      containerLogConfig,
	}
	if c.MemoryBytes > 0 {
		host["Memory"] = c.MemoryBytes
	}
	if c.PidsLimit > 0 {
		host["PidsLimit"] = c.PidsLimit
	}
	if c.Runtime != "" {
		host["Runtime"] = c.Runtime
	}
	if len(c.Hosts) > 0 {
		host["ExtraHosts"] = c.Hosts
	}
	return map[string]any{
		"Image":      c.Image,
		"Cmd":        c.Cmd,
		"Env":        c.Env,
		"User":       user,
		"WorkingDir": c.WorkDir,
		"Labels":     map[string]string{jobLabel: c.Name},
		"HostConfig": host,
	}
}

// CreateJobVolume makes a volume for a job, labelled as one.
func (d *Docker) CreateJobVolume(name string) error {
	return d.api.do("POST", "/volumes/create", nil, map[string]any{
		"Name": name, "Labels": map[string]string{jobLabel: name},
	}, nil, dockerCallTimeout)
}

// RemoveJobVolume drops a job's workspace; a volume already gone is fine.
func (d *Docker) RemoveJobVolume(name string) error {
	err := d.api.do("DELETE", "/volumes/"+name, url.Values{"force": {"true"}}, nil, nil, dockerCallTimeout)
	if isStatus(err, http.StatusNotFound) {
		return nil
	}
	return err
}

// EnsureJobNetwork creates an internal network for a job: no route out, the
// egress proxy its only way to the world.
func (d *Docker) EnsureJobNetwork(name string) error {
	err := d.api.do("POST", "/networks/create", nil, map[string]any{
		"Name": name, "Internal": true, "CheckDuplicate": true,
		"Labels": map[string]string{jobLabel: name},
	}, nil, dockerCallTimeout)
	if isStatus(err, http.StatusConflict) {
		return nil
	}
	return err
}

// RemoveJobNetwork drops a job's network.
func (d *Docker) RemoveJobNetwork(name string) error {
	err := d.api.do("DELETE", "/networks/"+name, nil, nil, nil, dockerCallTimeout)
	if isStatus(err, http.StatusNotFound) {
		return nil
	}
	return err
}

// ConnectNetwork attaches a running container to a network, with aliases.
func (d *Docker) ConnectNetwork(network, container string, aliases ...string) error {
	return d.api.do("POST", "/networks/"+network+"/connect", nil, map[string]any{
		"Container": container, "EndpointConfig": map[string]any{"Aliases": aliases},
	}, nil, dockerCallTimeout)
}

// HasRuntime says whether the daemon offers an OCI runtime, `runsc` for one.
func (d *Docker) HasRuntime(name string) (bool, error) {
	var info struct {
		Runtimes map[string]any `json:"Runtimes"`
	}
	if err := d.api.do("GET", "/info", nil, nil, &info, dockerCallTimeout); err != nil {
		return false, err
	}
	_, ok := info.Runtimes[name]
	return ok, nil
}

/*
RunJob runs one job step to its exit and streams its output as it is printed.

The container is created, started and followed; when ctx ends first it is
killed and ctx's error answered. It is removed whatever happens. The exit
code is answered when the process ran to an exit.
*/
func (d *Docker) RunJob(ctx context.Context, c JobContainer, stdout, stderr io.Writer) (int, error) {
	if err := d.EnsureImage(c.Image); err != nil {
		return -1, err
	}
	var created struct {
		ID string `json:"Id"`
	}
	if err := d.api.do("POST", "/containers/create", url.Values{"name": {c.Name}}, jobCreateBody(c), &created, dockerCallTimeout); err != nil {
		return -1, fmt.Errorf("create the job container: %w", err)
	}
	defer d.api.do("DELETE", "/containers/"+created.ID, url.Values{"force": {"true"}}, nil, nil, dockerCallTimeout)

	if err := d.api.do("POST", "/containers/"+created.ID+"/start", nil, nil, nil, dockerCallTimeout); err != nil {
		return -1, fmt.Errorf("start the job container: %w", err)
	}

	followed := make(chan error, 1)
	go func() {
		followed <- d.follow(ctx, created.ID, stdout, stderr)
	}()
	waited := make(chan int, 1)
	waitErr := make(chan error, 1)
	go func() {
		var out struct {
			StatusCode int `json:"StatusCode"`
		}
		// A job's deadline is ctx's; the call's own bound is a backstop.
		if err := d.api.do("POST", "/containers/"+created.ID+"/wait", nil, nil, &out, 12*time.Hour); err != nil {
			waitErr <- err
			return
		}
		waited <- out.StatusCode
	}()

	select {
	case code := <-waited:
		// The follow ends when the container's streams close.
		select {
		case <-followed:
		case <-time.After(5 * time.Second):
		}
		return code, nil
	case err := <-waitErr:
		return -1, err
	case <-ctx.Done():
		_ = d.api.do("POST", "/containers/"+created.ID+"/kill", nil, nil, nil, dockerCallTimeout)
		return -1, ctx.Err()
	}
}

// follow copies a container's demultiplexed logs to the writers until they
// close or ctx ends.
func (d *Docker) follow(ctx context.Context, id string, stdout, stderr io.Writer) error {
	body, err := d.api.stream(ctx, "GET", "/containers/"+id+"/logs",
		url.Values{"follow": {"1"}, "stdout": {"1"}, "stderr": {"1"}})
	if err != nil {
		return err
	}
	defer body.Close()
	return demuxTo(body, stdout, stderr)
}

/*
demuxTo splits Docker's multiplexed stream (an 8-byte header per frame: the
stream, three zeros, the size) between two writers, as the frames arrive.
*/
func demuxTo(r io.Reader, stdout, stderr io.Writer) error {
	header := make([]byte, 8)
	for {
		if _, err := io.ReadFull(r, header); err != nil {
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				return nil
			}
			return err
		}
		size := binary.BigEndian.Uint32(header[4:])
		out := stdout
		if header[0] == 2 {
			out = stderr
		}
		if _, err := io.CopyN(out, r, int64(size)); err != nil {
			return err
		}
	}
}

// stream sends a request whose answer is read as it comes, bounded by ctx.
func (d *dockerAPI) stream(ctx context.Context, method, path string, query url.Values) (io.ReadCloser, error) {
	target := d.base + path
	if len(query) > 0 {
		target += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, target, nil)
	if err != nil {
		return nil, err
	}
	res, err := d.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("docker: %s %s: %w", method, path, err)
	}
	if res.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		res.Body.Close()
		return nil, &dockerError{Status: res.StatusCode, Message: strings.TrimSpace(dockerMessage(data))}
	}
	return res.Body, nil
}

/*
EgressSidecar is a job's egress proxy (#Q3996): Bay's own static binary, bind
mounted read-only into a minimal image and run as `bay egress-proxy`, on the
default network (which routes) and attached to the job's internal network as
`egress`, the one name a job's HTTPS_PROXY points at. Unlike a job step it is
Bay's code, so it may mount Bay's binary; it runs non-root, with every
capability dropped and a read-only root, all the same.
*/
type EgressSidecar struct {
	Name    string
	Image   string
	Binary  string
	Allow   []string
	Network string
}

// EgressPort is where a job's egress proxy listens.
const EgressPort = 3128

/*
StartEgress starts a job's egress proxy and answers how to stop it, and its
address on the job's network; its output (one JSON line per refusal) goes to
out until it stops.

The address is what a step's /etc/hosts maps `egress` to. The alias alone is
answered by Docker's embedded DNS, at 127.0.0.11 inside the container, which
the daemon reaches through iptables rules in the container's network
namespace: gVisor's own network stack never sees them, so under `runsc` the
name did not resolve and every job failed to reach anything.
*/
func (d *Docker) StartEgress(ctx context.Context, s EgressSidecar, out io.Writer) (func(), string, error) {
	if err := d.EnsureImage(s.Image); err != nil {
		return nil, "", err
	}
	body := map[string]any{
		"Image": s.Image,
		"Cmd": []string{"/bay", "egress-proxy", "--listen", fmt.Sprintf("0.0.0.0:%d", EgressPort),
			"--allow", strings.Join(s.Allow, ",")},
		"User":   JobUser,
		"Labels": map[string]string{jobLabel: s.Name},
		"HostConfig": map[string]any{
			"Mounts":         []map[string]any{{"Type": "bind", "Source": s.Binary, "Target": "/bay", "ReadOnly": true}},
			"CapDrop":        []string{"ALL"},
			"SecurityOpt":    []string{"no-new-privileges:true"},
			"ReadonlyRootfs": true,
			"Memory":         int64(128 << 20),
			"PidsLimit":      int64(256),
			"LogConfig":      containerLogConfig,
		},
	}
	var created struct {
		ID string `json:"Id"`
	}
	if err := d.api.do("POST", "/containers/create", url.Values{"name": {s.Name}}, body, &created, dockerCallTimeout); err != nil {
		return nil, "", fmt.Errorf("create the egress proxy: %w", err)
	}
	stop := func() {
		_ = d.api.do("DELETE", "/containers/"+created.ID, url.Values{"force": {"true"}}, nil, nil, dockerCallTimeout)
	}
	if err := d.api.do("POST", "/containers/"+created.ID+"/start", nil, nil, nil, dockerCallTimeout); err != nil {
		stop()
		return nil, "", fmt.Errorf("start the egress proxy: %w", err)
	}
	if err := d.ConnectNetwork(s.Network, created.ID, "egress"); err != nil {
		stop()
		return nil, "", fmt.Errorf("attach the egress proxy to the job's network: %w", err)
	}
	var inspected struct {
		NetworkSettings struct {
			Networks map[string]struct {
				IPAddress string `json:"IPAddress"`
			} `json:"Networks"`
		} `json:"NetworkSettings"`
	}
	if err := d.api.do("GET", "/containers/"+created.ID+"/json", nil, nil, &inspected, dockerCallTimeout); err != nil {
		stop()
		return nil, "", fmt.Errorf("read the egress proxy's address: %w", err)
	}
	addr := inspected.NetworkSettings.Networks[s.Network].IPAddress
	if addr == "" {
		stop()
		return nil, "", fmt.Errorf("the egress proxy has no address on the job's network %s", s.Network)
	}
	logs, cancel := context.WithCancel(ctx)
	go func() { _ = d.follow(logs, created.ID, out, io.Discard) }()
	return func() { cancel(); stop() }, addr, nil
}
