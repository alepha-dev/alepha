package main

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
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

// probeApp answers with what its DATABASE_URL and REDIS_URL reach: the URL's
// scheme and host, whether Postgres accepts a connection there, and what Redis
// says to PING.
const probeApp = `
const http = require("node:http");
const net = require("node:net");
const reach = (raw, hello) => new Promise((resolve) => {
  let url;
  try { url = new URL(raw); } catch { return resolve("no url"); }
  const s = net.connect(Number(url.port), url.hostname, () => hello ? s.write(hello) : (resolve("connected"), s.end()));
  s.on("data", (d) => { resolve(d.toString().trim()); s.end(); });
  s.on("error", (e) => resolve("error: " + e.message));
});
http.createServer(async (req, res) => {
  const db = process.env.DATABASE_URL || "";
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    ready: true,
    database: db.split("@").pop(),
    postgres: await reach(db),
    redis: await reach(process.env.REDIS_URL, "PING\r\n"),
  }));
}).listen(Number(process.env.SERVER_PORT), process.env.SERVER_HOST);
`

/*
TestStackPostgresRedisDaemon applies the framework guide's compose file and
deploys an app that declares a database into it: the app must reach the
stack's Postgres and Redis through the stack variables, not a SQLite file
Bay provisioned for it.
*/
func TestStackPostgresRedisDaemon(t *testing.T) {
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
		router: router, keepReleases: defaultKeepReleases, readyWait: 60 * time.Second}
	front := httptest.NewServer(router)
	defer front.Close()

	env := "pr" + strconv.FormatInt(time.Now().UnixNano()%1e9, 36)
	t.Cleanup(func() {
		_ = d.Remove(memberKey("mcs", env, "web"), true)
		_ = d.DiscardCandidate(memberKey("mcs", env, "web"))
		_ = stack.Down(stack.Dir(root, "mcs", env), naming.StackProject("mcs", env), true)
	})

	compose, err := os.ReadFile(filepath.Join("testdata", "postgres-redis", "compose.yml"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := stack.SetVars(root, "mcs", env, map[string]string{
		"POSTGRES_PASSWORD": "s3cret",
		"DATABASE_URL":      "postgres://app:s3cret@db:5432/app",
		"REDIS_URL":         "redis://redis:6379",
	}); err != nil {
		t.Fatal(err)
	}
	bundles := t.TempDir()
	out, err := s.deployStack(context.Background(), stackDeployOptions{Stack: "mcs", Env: env,
		Bundle: tarGz(t, bundles, "r1.tar.gz", map[string]string{"compose.yml": string(compose)})})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Pending) != 1 {
		t.Fatalf("outcome = %+v", out)
	}
	if web, _ := s.store.Get(memberKey("mcs", env, "web")); web.StackApp != "myapp" {
		t.Fatalf("web member = %+v", web)
	}

	artifact := tarGz(t, bundles, "myapp.tar.gz", map[string]string{
		"manifest.json": `{"project": "myapp", "resources": {"hasDatabase": true}, "runtimes": [{"runtime": "node", "entry": "index.node.js", "runtimeVersion": "26"}]}`,
		"index.node.js": probeApp,
	})
	if _, failure := s.deployArtifact(context.Background(), deployArtifactOptions{
		Artifact: artifact, Name: state.MemberName("mcs", "web"), Env: env}); failure != nil {
		t.Fatalf("deploy: %v", failure)
	}

	req, _ := http.NewRequest(http.MethodGet, front.URL+"/", nil)
	req.Host = "mcs-" + env + ".bay.test"
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var got struct{ Database, Postgres, Redis string }
	body, _ := io.ReadAll(res.Body)
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("%d %s", res.StatusCode, body)
	}
	if got.Database != "db:5432/app" || got.Postgres != "connected" || got.Redis != "+PONG" {
		t.Fatalf("the app reached %+v, want the stack's Postgres and Redis", got)
	}
	if strings.Contains(string(body), "sqlite") {
		t.Fatalf("the app got a SQLite DATABASE_URL: %s", body)
	}
}
