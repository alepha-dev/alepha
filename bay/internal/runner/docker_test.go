package runner

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeEngine is a Docker Engine stand-in on a unix socket. It records every
// request and answers from `respond`, so the runner's calls are asserted
// without a daemon.
type fakeEngine struct {
	mu       sync.Mutex
	requests []fakeRequest
	respond  func(r fakeRequest) (int, string)
}

type fakeRequest struct {
	Method string
	Path   string // without the API version prefix
	Query  map[string]string
	Body   map[string]any
}

func (f *fakeEngine) calls() []fakeRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]fakeRequest(nil), f.requests...)
}

func startFakeEngine(t *testing.T, respond func(r fakeRequest) (int, string)) (*Docker, *fakeEngine) {
	t.Helper()
	// Short on purpose: a unix socket path is capped near 104 bytes on macOS,
	// and t.TempDir() under /var/folders can exceed it on its own.
	dir, err := os.MkdirTemp("", "bd")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	socket := filepath.Join(dir, "d.sock")
	ln, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	engine := &fakeEngine{respond: respond}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		req := fakeRequest{
			Method: r.Method,
			Path:   strings.TrimPrefix(r.URL.Path, "/"+dockerAPIVersion),
			Query:  map[string]string{},
		}
		for k, v := range r.URL.Query() {
			req.Query[k] = v[0]
		}
		if raw, _ := io.ReadAll(r.Body); len(raw) > 0 {
			_ = json.Unmarshal(raw, &req.Body)
		}
		engine.mu.Lock()
		engine.requests = append(engine.requests, req)
		engine.mu.Unlock()
		status, body := 200, ""
		if engine.respond != nil {
			status, body = engine.respond(req)
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	})}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close() })
	return &Docker{api: newDockerAPI(socket)}, engine
}

func TestDocker(t *testing.T) {
	t.Run("start stops and removes the old container, pulls a missing image by tag, creates and starts", func(t *testing.T) {
		d, engine := startFakeEngine(t, func(r fakeRequest) (int, string) {
			if r.Method == "GET" && strings.HasPrefix(r.Path, "/images/") {
				return 404, `{"message":"No such image"}`
			}
			if r.Path == "/containers/bay-lore-production/stop" {
				return 404, `{"message":"No such container"}`
			}
			if r.Method == "DELETE" {
				return 404, `{"message":"No such container"}`
			}
			return 200, ""
		})
		err := d.Start(Spec{
			Key:     "lore/production",
			Runtime: "node",
			Entry:   "index.node.js",
			Env:     map[string]string{"B": "2", "A": "1"},
			Sandbox: Container{Image: "node:26-slim", WorkDir: "/app", Port: 4100},
		})
		if err != nil {
			t.Fatal(err)
		}

		var got []string
		for _, c := range engine.calls() {
			got = append(got, c.Method+" "+c.Path)
		}
		want := []string{
			"POST /containers/bay-lore-production/stop",
			"DELETE /containers/bay-lore-production",
			"GET /images/node:26-slim/json",
			"POST /images/create",
			"POST /containers/create",
			"POST /containers/bay-lore-production/start",
		}
		if strings.Join(got, "\n") != strings.Join(want, "\n") {
			t.Fatalf("calls:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
		}
		pull := engine.calls()[3]
		if pull.Query["fromImage"] != "node" || pull.Query["tag"] != "26-slim" {
			t.Fatalf("pull query = %v", pull.Query)
		}
		create := engine.calls()[4]
		if create.Query["name"] != "bay-lore-production" {
			t.Fatalf("container name = %q", create.Query["name"])
		}
		if env := create.Body["Env"].([]any); env[0] != "A=1" || env[1] != "B=2" {
			t.Fatalf("env not sorted: %v", env)
		}
	})

	t.Run("start refuses a spec without a Container or an image", func(t *testing.T) {
		d, _ := startFakeEngine(t, nil)
		if err := d.Start(Spec{Key: "a/b"}); err == nil {
			t.Fatal("expected a refusal without a Container")
		}
		if err := d.Start(Spec{Key: "a/b", Sandbox: Container{}}); err == nil {
			t.Fatal("expected a refusal without an image")
		}
	})

	t.Run("a pull that fails mid-stream is an error, not a success", func(t *testing.T) {
		d, _ := startFakeEngine(t, func(r fakeRequest) (int, string) {
			if r.Method == "GET" {
				return 404, `{"message":"No such image"}`
			}
			return 200, "{\"status\":\"Pulling\"}\n{\"error\":\"no matching manifest for linux/arm64\"}\n"
		})
		err := d.EnsureImage("node:26-slim")
		if err == nil || !strings.Contains(err.Error(), "no matching manifest") {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("stop tolerates a missing or already stopped container", func(t *testing.T) {
		for _, status := range []int{404, 304} {
			d, _ := startFakeEngine(t, func(fakeRequest) (int, string) { return status, "" })
			if err := d.Stop("a/b", time.Second); err != nil {
				t.Fatalf("status %d: %v", status, err)
			}
		}
	})

	t.Run("stop passes the grace to docker and fails on a real error", func(t *testing.T) {
		d, engine := startFakeEngine(t, func(fakeRequest) (int, string) { return 500, `{"message":"boom"}` })
		err := d.Stop("a/b", 25*time.Second)
		if err == nil || !strings.Contains(err.Error(), "boom") {
			t.Fatalf("err = %v", err)
		}
		if engine.calls()[0].Query["t"] != "25" {
			t.Fatalf("t = %q", engine.calls()[0].Query["t"])
		}
	})

	t.Run("park stops, then turns the restart policy off", func(t *testing.T) {
		d, engine := startFakeEngine(t, nil)
		if err := d.Park("a/b", time.Second); err != nil {
			t.Fatal(err)
		}
		calls := engine.calls()
		if len(calls) != 2 || calls[0].Path != "/containers/bay-a-b/stop" || calls[1].Path != "/containers/bay-a-b/update" {
			t.Fatalf("calls = %+v", calls)
		}
		policy := calls[1].Body["RestartPolicy"].(map[string]any)
		if policy["Name"] != "no" {
			t.Fatalf("policy = %v", policy)
		}
	})

	t.Run("an unknown container is inactive, not running, and has no logs", func(t *testing.T) {
		d, _ := startFakeEngine(t, func(fakeRequest) (int, string) { return 404, `{"message":"No such container"}` })
		if d.Running("a/b") {
			t.Fatal("running")
		}
		if s := d.State("a/b"); s != "inactive" {
			t.Fatalf("state = %q", s)
		}
		if _, found, err := d.Logs("a/b", 10); found || err != nil {
			t.Fatalf("found = %v, err = %v", found, err)
		}
		if _, ok := d.Usage("a/b"); ok {
			t.Fatal("usage for a missing container")
		}
	})

	t.Run("an unreachable daemon has no state rather than a made-up one", func(t *testing.T) {
		d := &Docker{api: newDockerAPI(filepath.Join(t.TempDir(), "absent.sock"))}
		if s := d.State("a/b"); s != "" {
			t.Fatalf("state = %q", s)
		}
	})

	t.Run("usage reads memory, cpu, tasks, restarts and start time", func(t *testing.T) {
		d, _ := startFakeEngine(t, func(r fakeRequest) (int, string) {
			if strings.HasSuffix(r.Path, "/stats") {
				return 200, `{"memory_stats":{"usage":1048576},"cpu_stats":{"cpu_usage":{"total_usage":2500000000}},"pids_stats":{"current":11}}`
			}
			return 200, `{"RestartCount":3,"State":{"Status":"running","Running":true,"Pid":42,"StartedAt":"2026-10-23T10:00:00.5Z"}}`
		})
		u, ok := d.Usage("a/b")
		if !ok {
			t.Fatal("no usage")
		}
		if u.MemoryBytes != 1048576 || u.CPUSeconds != 2.5 || u.Tasks != 11 || u.Restarts != 3 || u.PID != 42 {
			t.Fatalf("usage = %+v", u)
		}
		if u.StartedAt.Year() != 2026 {
			t.Fatalf("startedAt = %v", u.StartedAt)
		}
	})
}

func TestCreateBody(t *testing.T) {
	spec := Spec{Key: "lore/production", Runtime: "node", Entry: "index.node.js"}

	t.Run("publishes the port on loopback only", func(t *testing.T) {
		body := createBody(spec, Container{Image: "x", Port: 4100})
		host := body["HostConfig"].(map[string]any)
		bindings := host["PortBindings"].(map[string]any)["4100/tcp"].([]map[string]string)
		if len(bindings) != 1 || bindings[0]["HostIp"] != "127.0.0.1" || bindings[0]["HostPort"] != "4100" {
			t.Fatalf("bindings = %v", bindings)
		}
	})

	t.Run("restarts always, runs an init, labels the instance", func(t *testing.T) {
		body := createBody(spec, Container{Image: "x"})
		host := body["HostConfig"].(map[string]any)
		if host["RestartPolicy"].(map[string]any)["Name"] != "always" || host["Init"] != true {
			t.Fatalf("host = %v", host)
		}
		if body["Labels"].(map[string]string)[dockerKeyLabel] != "lore/production" {
			t.Fatalf("labels = %v", body["Labels"])
		}
		if cmd := body["Cmd"].([]string); cmd[0] != "node" || cmd[1] != "index.node.js" {
			t.Fatalf("cmd = %v", cmd)
		}
	})

	t.Run("omits unset limits rather than sending zero", func(t *testing.T) {
		host := createBody(spec, Container{Image: "x"})["HostConfig"].(map[string]any)
		for _, key := range []string{"Memory", "PidsLimit", "NanoCpus", "PortBindings"} {
			if _, set := host[key]; set {
				t.Fatalf("%s set on an unlimited container", key)
			}
		}
	})

	t.Run("carries limits, mounts and the stop grace", func(t *testing.T) {
		body := createBody(spec, Container{
			Image: "x", MemoryBytes: 512 << 20, PidsLimit: 256, NanoCPUs: 2e9,
			StopGrace: 20 * time.Second,
			Mounts:    []Mount{{Source: "/srv/rel", Target: "/app", ReadOnly: true}},
		})
		host := body["HostConfig"].(map[string]any)
		if host["Memory"] != int64(512<<20) || host["PidsLimit"] != int64(256) || host["NanoCpus"] != int64(2e9) {
			t.Fatalf("limits = %v", host)
		}
		mount := host["Mounts"].([]map[string]any)[0]
		if mount["Source"] != "/srv/rel" || mount["Target"] != "/app" || mount["ReadOnly"] != true || mount["Type"] != "bind" {
			t.Fatalf("mount = %v", mount)
		}
		if body["StopTimeout"] != 20 {
			t.Fatalf("stop timeout = %v", body["StopTimeout"])
		}
	})

	t.Run("an unset grace is Bay's default, not docker's ten seconds", func(t *testing.T) {
		if got := createBody(spec, Container{Image: "x"})["StopTimeout"]; got != int(defaultStopGrace.Seconds()) {
			t.Fatalf("stop timeout = %v", got)
		}
	})
}

func TestSplitImageRef(t *testing.T) {
	cases := map[string][2]string{
		"node:26-slim":                        {"node", "26-slim"},
		"node":                                {"node", "latest"},
		"localhost:5000/team/app":             {"localhost:5000/team/app", "latest"},
		"localhost:5000/team/app:1.2":         {"localhost:5000/team/app", "1.2"},
		"node:26-slim@sha256:abc":             {"node", "sha256:abc"},
		"registry.acme.io/api@sha256:def":     {"registry.acme.io/api", "sha256:def"},
		"registry.acme.io:443/api:1@sha256:0": {"registry.acme.io:443/api", "sha256:0"},
	}
	for ref, want := range cases {
		from, tag := splitImageRef(ref)
		if from != want[0] || tag != want[1] {
			t.Errorf("%s: got (%s, %s), want (%s, %s)", ref, from, tag, want[0], want[1])
		}
	}
}

func TestContainerState(t *testing.T) {
	cases := []struct {
		status     string
		restarting bool
		oom        bool
		exit       int
		want       string
	}{
		{"running", false, false, 0, "active"},
		{"running", true, false, 0, "activating"},
		{"restarting", false, false, 1, "activating"},
		{"exited", false, false, 0, "inactive"},
		{"exited", false, false, 143, "inactive"},
		{"exited", false, false, 1, "failed"},
		{"exited", false, false, 137, "failed"},
		{"exited", false, true, 0, "failed"},
		{"created", false, false, 0, "inactive"},
		{"removing", false, false, 0, "deactivating"},
	}
	for _, c := range cases {
		var info inspect
		info.State.Status = c.status
		info.State.Restarting = c.restarting
		info.State.OOMKilled = c.oom
		info.State.ExitCode = c.exit
		if got := containerState(info); got != c.want {
			t.Errorf("%+v: got %q, want %q", c, got, c.want)
		}
	}
}

func TestParseDockerLogs(t *testing.T) {
	frame := func(stream byte, text string) []byte {
		header := make([]byte, 8)
		header[0] = stream
		binary.BigEndian.PutUint32(header[4:], uint32(len(text)))
		return append(header, text...)
	}
	var stream []byte
	stream = append(stream, frame(1, "2026-10-23T10:00:00.000000001Z hello ")...)
	// A chunk boundary inside a line: the line must come back whole.
	stream = append(stream, frame(1, "world\n2026-10-23T10:00:01Z ")...)
	stream = append(stream, frame(2, `{"level":"error","msg":"boom"}`+"\n")...)

	lines := parseDockerLogs(stream)
	if len(lines) != 2 {
		t.Fatalf("lines = %+v", lines)
	}
	if lines[0].Raw != "hello world" || lines[0].At.IsZero() {
		t.Fatalf("first = %+v", lines[0])
	}
	if lines[1].Level != "error" || lines[1].Text != "boom" {
		t.Fatalf("second = %+v", lines[1])
	}
}

func TestResolveDigest(t *testing.T) {
	t.Run("pulls the tag and answers it pinned to the registry digest", func(t *testing.T) {
		d, engine := startFakeEngine(t, func(r fakeRequest) (int, string) {
			if r.Method == "GET" {
				return 200, `{"RepoDigests":["registry.example/other@sha256:no","docker.io/library/node@sha256:abc"]}`
			}
			return 200, `{"status":"Downloaded newer image"}`
		})
		ref, err := d.ResolveDigest("node:26-slim")
		if err != nil || ref != "node:26-slim@sha256:abc" {
			t.Fatalf("ref = %q, err = %v", ref, err)
		}
		if pull := engine.calls()[0]; pull.Path != "/images/create" || pull.Query["tag"] != "26-slim" {
			t.Fatalf("pull = %+v", pull)
		}
	})

	t.Run("an image with no registry digest is an error", func(t *testing.T) {
		d, _ := startFakeEngine(t, func(r fakeRequest) (int, string) {
			if r.Method == "GET" {
				return 200, `{"RepoDigests":[]}`
			}
			return 200, ""
		})
		if _, err := d.ResolveDigest("node:26-slim"); err == nil {
			t.Fatal("expected an error")
		}
	})
}

func TestWaitHealthy(t *testing.T) {
	t.Run("no healthcheck declared answers at once, not declared", func(t *testing.T) {
		d, _ := startFakeEngine(t, func(fakeRequest) (int, string) { return 200, `{"State":{}}` })
		declared, err := d.WaitHealthy("a/b", false, time.Second)
		if declared || err != nil {
			t.Fatalf("declared = %v, err = %v", declared, err)
		}
	})

	t.Run("healthy passes, and the candidate is asked by its own name", func(t *testing.T) {
		d, engine := startFakeEngine(t, func(fakeRequest) (int, string) {
			return 200, `{"State":{"Health":{"Status":"healthy"}}}`
		})
		declared, err := d.WaitHealthy("a/b", true, time.Second)
		if !declared || err != nil {
			t.Fatalf("declared = %v, err = %v", declared, err)
		}
		if engine.calls()[0].Path != "/containers/bay-a-b-next/json" {
			t.Fatalf("asked %s", engine.calls()[0].Path)
		}
	})

	t.Run("unhealthy fails with the check's last output", func(t *testing.T) {
		d, _ := startFakeEngine(t, func(fakeRequest) (int, string) {
			return 200, `{"State":{"Health":{"Status":"unhealthy","Log":[{"Output":"curl: connection refused"}]}}}`
		})
		declared, err := d.WaitHealthy("a/b", false, time.Second)
		if !declared || err == nil || !strings.Contains(err.Error(), "connection refused") {
			t.Fatalf("declared = %v, err = %v", declared, err)
		}
	})
}

func TestCreateBodyForAnImageApp(t *testing.T) {
	t.Run("an image app keeps its image's own command and working directory", func(t *testing.T) {
		body := createBody(Spec{Key: "api/production"}, Container{Image: "x@sha256:1", Port: 3000, HostPort: 41000})
		if _, set := body["Cmd"]; set {
			t.Fatalf("cmd = %v", body["Cmd"])
		}
		if _, set := body["WorkingDir"]; set {
			t.Fatalf("workdir = %v", body["WorkingDir"])
		}
		bindings := body["HostConfig"].(map[string]any)["PortBindings"].(map[string]any)["3000/tcp"].([]map[string]string)
		if bindings[0]["HostPort"] != "41000" || bindings[0]["HostIp"] != "127.0.0.1" {
			t.Fatalf("bindings = %v", bindings)
		}
	})
}
