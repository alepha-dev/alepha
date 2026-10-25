package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/health"
	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/proxy"
	"github.com/alepha-dev/bay/internal/runner"
	"github.com/alepha-dev/bay/internal/stack"
	"github.com/alepha-dev/bay/internal/state"
)

/*
The acceptance scenarios of E74: what a user of Stacks does, end to end, on a
real Docker daemon. Each one is a whole story rather than a unit, so a
regression shows up as the story that broke.
*/

// acceptanceServer is a Bay with a router behind a test front door and a TCP forwarder.
type acceptanceServer struct {
	*server
	front *httptest.Server
}

func newAcceptanceServer(t *testing.T, d *runner.Docker) *acceptanceServer {
	t.Helper()
	root := daemonRoot(t, d)
	store, err := state.Open(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetBaseDomain("bay.test"); err != nil {
		t.Fatal(err)
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	router := proxy.New(root, store, log)
	s := &server{root: root, store: store, runner: d, probe: &health.Probe{}, log: log,
		router: router, keepReleases: defaultKeepReleases, readyWait: 60 * time.Second, tcp: proxy.NewTCP(log)}
	front := httptest.NewServer(router)
	t.Cleanup(front.Close)
	t.Cleanup(func() { s.tcp.Close() })
	return &acceptanceServer{server: s, front: front}
}

// get asks the router for path on host, the way a browser on that domain would.
func (a *acceptanceServer) get(host, path string) (int, string) {
	req, _ := http.NewRequest(http.MethodGet, a.front.URL+path, nil)
	req.Host = host
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, err.Error()
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(body)
}

// bundleOf packs a testdata directory as a stack bundle.
func bundleOf(t *testing.T, dir string) string {
	t.Helper()
	path, err := packBundle(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Remove(path) })
	return path
}

func (a *acceptanceServer) purge(name, env string) {
	for _, m := range a.store.StackMembers(name, env) {
		_ = a.runner.Remove(m.Key(), true)
	}
	_ = stack.Down(stack.Dir(a.root, name, env), naming.StackProject(name, env), true)
}

// networksOf answers the Docker networks a container is attached to.
func networksOf(t *testing.T, container string) []string {
	t.Helper()
	out, err := exec.Command("docker", "inspect", "-f", "{{json .NetworkSettings.Networks}}", container).Output()
	if err != nil {
		t.Fatalf("inspect %s: %v", container, err)
	}
	var nets map[string]any
	_ = json.Unmarshal(out, &nets)
	var names []string
	for n := range nets {
		names = append(names, n)
	}
	return names
}

func TestUmamiTwoEnvironmentsDaemon(t *testing.T) {
	d := daemonDocker(t)
	requireComposeCLI(t)
	a := newAcceptanceServer(t, d)
	envs := []string{"production", "staging"}
	for _, env := range envs {
		t.Cleanup(func() { a.purge("umami", env) })
	}

	t.Run("the official compose file deploys unmodified into two environments", func(t *testing.T) {
		for _, env := range envs {
			if _, err := a.deployStack(context.Background(), stackDeployOptions{Stack: "umami", Env: env,
				Bundle: bundleOf(t, "testdata/umami")}); err != nil {
				t.Fatalf("%s: %v", env, err)
			}
		}
	})

	t.Run("environment routes alone put each on its own domain", func(t *testing.T) {
		for _, env := range envs {
			domain := "umami-" + env + ".example.test"
			rec := httptest.NewRecorder()
			a.controlMux().ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/stacks/umami/"+env+"/routes",
				strings.NewReader(`{"service": "umami", "domain": "`+domain+`"}`)))
			if rec.Code != 200 {
				t.Fatalf("%s: %d %s", env, rec.Code, rec.Body.String())
			}
			if status, body := a.get(domain, "/api/heartbeat"); status != 200 {
				t.Fatalf("%s: %d %.120s", domain, status, body)
			}
		}
	})

	t.Run("each environment has its own database volume", func(t *testing.T) {
		seen := map[string]string{}
		for _, env := range envs {
			vols, err := d.ProjectVolumes(naming.StackProject("umami", env))
			if err != nil || len(vols) != 1 {
				t.Fatalf("%s volumes = %v, %v", env, vols, err)
			}
			if other, dup := seen[vols[0].Name]; dup {
				t.Fatalf("%s and %s share the volume %s", env, other, vols[0].Name)
			}
			seen[vols[0].Name] = env
		}
	})

	t.Run("neither environment can reach the other's network", func(t *testing.T) {
		prodNets := networksOf(t, runner.ContainerName(memberKey("umami", "production", "umami")))
		stagingDB := runner.ContainerName(memberKey("umami", "staging", "db"))
		for _, n := range networksOf(t, stagingDB) {
			for _, p := range prodNets {
				if n == p {
					t.Fatalf("production's umami and staging's db share the network %s", n)
				}
			}
		}
		prodApp := runner.ContainerName(memberKey("umami", "production", "umami"))
		out, err := exec.Command("docker", "exec", prodApp, "getent", "hosts", stagingDB).CombinedOutput()
		if err == nil {
			t.Fatalf("production resolves staging's database: %s", out)
		}
		out, err = exec.Command("docker", "exec", prodApp, "getent", "hosts", "db").CombinedOutput()
		if err != nil || len(bytes.TrimSpace(out)) == 0 {
			t.Fatalf("production does not resolve its own db: %v %s", err, out)
		}
	})
}

// appStackCompose is an app service with Postgres and Redis, the shape of an
// Alepha application deployed as a stack.
func appStackCompose(redisTag string) string {
	return `services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 1s
      timeout: 3s
      retries: 30
  cache:
    image: redis:` + redisTag + `
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 1s
      timeout: 3s
      retries: 20
  api:
    depends_on: [db, cache]
    x-lore:
      app: api
      routes: ["@"]
volumes:
  pgdata:
`
}

// dbApp answers whether it reaches both services by name, and which release it is.
const dbApp = `
const http = require("node:http");
const net = require("node:net");
const reach = (port, host) => new Promise((resolve) => {
  const s = net.connect(port, host, () => { s.end(); resolve(true); });
  s.on("error", () => resolve(false));
});
http.createServer(async (req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ready: true, release: RELEASE, db: await reach(5432, "db"), cache: await reach(6379, "cache") }));
}).listen(Number(process.env.SERVER_PORT), process.env.SERVER_HOST);
`

func TestAppStackDaemon(t *testing.T) {
	d := daemonDocker(t)
	requireComposeCLI(t)
	a := newAcceptanceServer(t, d)
	env := "ap" + strconv.FormatInt(time.Now().UnixNano()%1e9, 36)
	t.Cleanup(func() { a.purge("shop", env) })
	bundles := t.TempDir()
	domain := "shop-" + env + ".bay.test"
	db := runner.ContainerName(memberKey("shop", env, "db"))
	psql := func(sql string) (string, error) {
		out, err := exec.Command("docker", "exec", db, "psql", "-U", "app", "-d", "app", "-tAc", sql).CombinedOutput()
		return strings.TrimSpace(string(out)), err
	}
	release := func(name, n string) {
		t.Helper()
		artifact := tarGz(t, bundles, name, map[string]string{
			"manifest.json": `{"project": "api", "runtimes": [{"runtime": "node", "entry": "index.node.js", "runtimeVersion": "26"}]}`,
			"index.node.js": "const RELEASE = " + n + ";\n" + dbApp,
		})
		if _, failure := a.deployArtifact(context.Background(), deployArtifactOptions{
			Artifact: artifact, Name: state.MemberName("shop", "api"), Env: env}); failure != nil {
			t.Fatalf("deploy: %v", failure)
		}
	}
	started := func(service string) time.Time {
		u, _ := d.Usage(memberKey("shop", env, service))
		return u.StartedAt
	}

	t.Run("the stack and its app deploy, and the app reaches both services by name", func(t *testing.T) {
		if _, err := a.deployStack(context.Background(), stackDeployOptions{Stack: "shop", Env: env,
			Bundle: tarGz(t, bundles, "r1.tar.gz", map[string]string{"compose.yml": appStackCompose("7-alpine")})}); err != nil {
			t.Fatal(err)
		}
		release("a1.tar.gz", "1")
		if status, body := a.get(domain, "/"); status != 200 || !strings.Contains(body, `"release":1,"db":true,"cache":true`) {
			t.Fatalf("api: %d %s", status, body)
		}
		if _, err := psql("create table kept (v text); insert into kept values ('survives')"); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("redeploying the app restarts no other container", func(t *testing.T) {
		dbAt, cacheAt := started("db"), started("cache")
		release("a2.tar.gz", "2")
		if status, body := a.get(domain, "/"); status != 200 || !strings.Contains(body, `"release":2`) {
			t.Fatalf("api: %d %s", status, body)
		}
		if !started("db").Equal(dbAt) || !started("cache").Equal(cacheAt) {
			t.Fatal("an app redeploy recreated a service")
		}
	})

	t.Run("a new revision and a rollback keep the database and the app", func(t *testing.T) {
		if _, err := a.deployStack(context.Background(), stackDeployOptions{Stack: "shop", Env: env,
			Bundle: tarGz(t, bundles, "r2.tar.gz", map[string]string{"compose.yml": appStackCompose("8-alpine")})}); err != nil {
			t.Fatal(err)
		}
		out, err := a.deployStack(context.Background(), stackDeployOptions{Stack: "shop", Env: env, Revision: 1})
		if err != nil || out.Revision != 1 {
			t.Fatalf("rollback: %+v %v", out, err)
		}
		if v, err := psql("select v from kept"); err != nil || v != "survives" {
			t.Fatalf("the database after a rollback: %q %v", v, err)
		}
		if status, body := a.get(domain, "/"); status != 200 || !strings.Contains(body, `"release":2,"db":true,"cache":true`) {
			t.Fatalf("api after the rollback: %d %s", status, body)
		}
	})
}

func TestMosquittoRawTCPDaemon(t *testing.T) {
	d := daemonDocker(t)
	requireComposeCLI(t)
	a := newAcceptanceServer(t, d)
	env := "mq" + strconv.FormatInt(time.Now().UnixNano()%1e9, 36)
	t.Cleanup(func() { a.purge("broker", env); a.syncTCP() })

	if _, err := a.deployStack(context.Background(), stackDeployOptions{Stack: "broker", Env: env,
		Bundle: bundleOf(t, "testdata/mosquitto")}); err != nil {
		t.Fatal(err)
	}

	t.Run("the bundled mosquitto.conf is what the broker runs, reached on its port over raw TCP", func(t *testing.T) {
		// An MQTT 3.1.1 CONNECT for client "t" with a clean session; the broker
		// answers CONNACK, accepted, only if it listens where the bundled
		// config says and lets anonymous clients in.
		connect := []byte{0x10, 0x0d, 0x00, 0x04, 'M', 'Q', 'T', 'T', 0x04, 0x02, 0x00, 0x3c, 0x00, 0x01, 't'}
		var ack []byte
		deadline := time.Now().Add(20 * time.Second)
		for time.Now().Before(deadline) {
			ack = mqttConnect(connect)
			if len(ack) == 4 {
				break
			}
			time.Sleep(300 * time.Millisecond)
		}
		if !bytes.Equal(ack, []byte{0x20, 0x02, 0x00, 0x00}) {
			t.Fatalf("CONNACK = %x", ack)
		}
	})

	t.Run("destroying the environment closes the port", func(t *testing.T) {
		if _, err := a.destroyStack("broker", env, true); err != nil {
			t.Fatal(err)
		}
		if err := proxy.PortFree(21883); err != nil {
			t.Fatalf("port 21883 is still held: %v", err)
		}
	})
}

func mqttConnect(packet []byte) []byte {
	c, err := net.DialTimeout("tcp", "127.0.0.1:21883", 2*time.Second)
	if err != nil {
		return nil
	}
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err := c.Write(packet); err != nil {
		return nil
	}
	buf := make([]byte, 4)
	n, _ := io.ReadFull(c, buf)
	return buf[:n]
}
