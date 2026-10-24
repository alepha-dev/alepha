package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"log/slog"
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
	"github.com/alepha-dev/bay/internal/stack"
	"github.com/alepha-dev/bay/internal/state"
)

// tarGz packs files into a gzip tar under dir, answering its path.
func tarGz(t *testing.T, dir, name string, files map[string]string) string {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for n, body := range files {
		if err := tw.WriteHeader(&tar.Header{Name: n, Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(body))}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	tw.Close()
	gz.Close()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func shopCompose(nginxTag string) string {
	return `services:
  cache:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 1s
      timeout: 3s
      retries: 20
  web:
    image: nginx:` + nginxTag + `
    ports: ["8080:80"]
    x-lore:
      routes: ["@"]
  api:
    x-lore:
      app: api
      routes: ["api"]
`
}

// pingApp is an archive whose app answers with what Redis says to PING,
// reached by its service name on the stack's network.
const pingApp = `
const http = require("node:http");
const net = require("node:net");
const ping = () => new Promise((resolve) => {
  const s = net.connect(6379, "cache", () => s.write("PING\r\n"));
  s.on("data", (d) => { resolve(d.toString().trim()); s.end(); });
  s.on("error", (e) => resolve("error: " + e.message));
});
http.createServer(async (req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ready: true, redis: await ping() }));
}).listen(Number(process.env.SERVER_PORT), process.env.SERVER_HOST);
`

func TestStackDeployDaemon(t *testing.T) {
	d := daemonDocker(t)
	requireComposeCLI(t)
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
		router: router, keepReleases: defaultKeepReleases, readyWait: 20 * time.Second}
	front := httptest.NewServer(router)
	defer front.Close()

	env := "st" + strconv.FormatInt(time.Now().UnixNano()%1e9, 36)
	t.Cleanup(func() {
		_ = d.Remove(memberKey("shop", env, "api"), true)
		_ = d.DiscardCandidate(memberKey("shop", env, "api"))
		_ = stack.Down(stack.Dir(root, "shop", env), naming.StackProject("shop", env), true)
	})
	get := func(host string) (int, string) {
		req, _ := http.NewRequest(http.MethodGet, front.URL+"/", nil)
		req.Host = host
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			return 0, err.Error()
		}
		defer res.Body.Close()
		body, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(body)
	}
	base := "shop-" + env + ".bay.test"
	bundles := t.TempDir()

	var webStarted time.Time
	t.Run("a stack deploys: services healthy, the routed one served, the app pending", func(t *testing.T) {
		out, err := s.deployStack(context.Background(), stackDeployOptions{Stack: "shop", Env: env,
			Bundle: tarGz(t, bundles, "r1.tar.gz", map[string]string{"compose.yml": shopCompose("1.29-alpine")})})
		if err != nil {
			t.Fatal(err)
		}
		if out.Revision != 1 || strings.Join(out.Plan.Created, ",") != "api,cache,web" || len(out.Pending) != 1 {
			t.Fatalf("outcome = %+v", out)
		}
		if !strings.HasPrefix(out.Digests["web"].(string), "nginx:1.29-alpine@sha256:") {
			t.Fatalf("digests = %v", out.Digests)
		}
		if status, body := get(base); status != 200 || !strings.Contains(body, "nginx") {
			t.Fatalf("web: %d %.80s", status, body)
		}
		if !d.Running(memberKey("shop", env, "cache")) {
			t.Fatal("the cache member is not found running under its Bay name")
		}
		u, ok := d.Usage(memberKey("shop", env, "web"))
		if !ok {
			t.Fatal("no usage for web")
		}
		webStarted = u.StartedAt
	})

	t.Run("an artifact deployed into the app service reaches its services by name", func(t *testing.T) {
		artifact := tarGz(t, bundles, "api.tar.gz", map[string]string{
			"manifest.json": `{"project": "api", "runtimes": [{"runtime": "node", "entry": "index.node.js", "runtimeVersion": "26"}]}`,
			"index.node.js": pingApp,
		})
		if _, failure := s.deployArtifact(context.Background(), deployArtifactOptions{
			Artifact: artifact, Name: state.MemberName("shop", "api"), Env: env}); failure != nil {
			t.Fatalf("deploy: %v", failure)
		}
		status, body := get("api." + base)
		if status != 200 || !strings.Contains(body, `"redis":"+PONG"`) {
			t.Fatalf("api: %d %s", status, body)
		}
		if u, _ := d.Usage(memberKey("shop", env, "web")); !u.StartedAt.Equal(webStarted) {
			t.Fatal("deploying the app service recreated another service")
		}
	})

	t.Run("reapplying the revision changes nothing and recreates nothing", func(t *testing.T) {
		out, err := s.deployStack(context.Background(), stackDeployOptions{Stack: "shop", Env: env})
		if err != nil {
			t.Fatal(err)
		}
		if len(out.Plan.Created)+len(out.Plan.Changed)+len(out.Plan.Removed) != 0 {
			t.Fatalf("plan = %+v", out.Plan)
		}
		if u, _ := d.Usage(memberKey("shop", env, "web")); !u.StartedAt.Equal(webStarted) {
			t.Fatalf("web was recreated: %v -> %v", webStarted, u.StartedAt)
		}
	})

	var cacheStarted time.Time
	t.Run("a new revision recreates only the service it changes", func(t *testing.T) {
		u, _ := d.Usage(memberKey("shop", env, "cache"))
		cacheStarted = u.StartedAt
		dry, err := s.deployStack(context.Background(), stackDeployOptions{Stack: "shop", Env: env, DryRun: true,
			Bundle: tarGz(t, bundles, "r2.tar.gz", map[string]string{"compose.yml": shopCompose("1.28-alpine")})})
		if err != nil {
			t.Fatal(err)
		}
		if strings.Join(dry.Plan.Changed, ",") != "web" || len(dry.Plan.Created) != 0 ||
			strings.Join(dry.Plan.Fields["web"], ",") != "image" {
			t.Fatalf("dry plan = %+v", dry.Plan)
		}
		if len(dry.Warnings) != 1 || !strings.Contains(dry.Warnings[0], "service web has no healthcheck") {
			t.Fatalf("warnings = %v", dry.Warnings)
		}
		if env, _ := store.StackEnv("shop", env); env.Revision != 1 {
			t.Fatalf("a dry run moved the revision to %d", env.Revision)
		}
		out, err := s.deployStack(context.Background(), stackDeployOptions{Stack: "shop", Env: env,
			Bundle: tarGz(t, bundles, "r2b.tar.gz", map[string]string{"compose.yml": shopCompose("1.28-alpine")})})
		if err != nil {
			t.Fatal(err)
		}
		if out.Revision != 2 || !strings.HasPrefix(out.Digests["web"].(string), "nginx:1.28-alpine@") {
			t.Fatalf("outcome = %+v", out)
		}
		if u, _ := d.Usage(memberKey("shop", env, "cache")); !u.StartedAt.Equal(cacheStarted) {
			t.Fatal("the cache was recreated by a revision that did not change it")
		}
		if status, _ := get(base); status != 200 {
			t.Fatalf("web after the revision: %d", status)
		}
	})

	t.Run("a rollback reapplies the earlier revision with its recorded digests", func(t *testing.T) {
		before, _ := store.StackEnv("shop", env)
		out, err := s.deployStack(context.Background(), stackDeployOptions{Stack: "shop", Env: env, Revision: 1})
		if err != nil {
			t.Fatal(err)
		}
		if out.Revision != 1 || out.Digests["web"] != before.Revisions[0].Digests["web"] {
			t.Fatalf("outcome = %+v", out)
		}
		if status, body := get("api." + base); status != 200 || !strings.Contains(body, "PONG") {
			t.Fatalf("api after the rollback: %d %s", status, body)
		}
	})

	t.Run("an environment route serves a full domain at once", func(t *testing.T) {
		domain := "www-" + env + ".example.test"
		rec := httptest.NewRecorder()
		s.controlMux().ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/stacks/shop/"+env+"/routes",
			strings.NewReader(`{"service": "web", "domain": "`+domain+`"}`)))
		if rec.Code != 200 {
			t.Fatalf("%d %s", rec.Code, rec.Body.String())
		}
		if status, body := get(domain); status != 200 || !strings.Contains(body, "nginx") {
			t.Fatalf("%s: %d %.80s", domain, status, body)
		}
		if status, _ := get(base); status != 200 {
			t.Fatalf("the label route stopped serving: %d", status)
		}
	})
}

// requireComposeCLI is the stack package's requireCompose, for this package.
func requireComposeCLI(t *testing.T) {
	t.Helper()
	if err := exec.Command(stack.ComposeCommand, "compose", "version").Run(); err != nil {
		if os.Getenv("BAY_REQUIRE_DOCKER") == "1" {
			t.Fatalf("BAY_REQUIRE_DOCKER=1 but docker compose is not available: %v", err)
		}
		t.Skipf("docker compose is not available (%v)", err)
	}
}
