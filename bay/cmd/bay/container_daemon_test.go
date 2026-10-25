package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/backup"
	"github.com/alepha-dev/bay/internal/health"
	"github.com/alepha-dev/bay/internal/runner"
	"github.com/alepha-dev/bay/internal/state"
)

/*
daemonDocker connects to the real daemon, failing under BAY_REQUIRE_DOCKER=1
and skipping otherwise, like the runner package's requireDocker.
*/
func daemonDocker(t *testing.T) *runner.Docker {
	t.Helper()
	d, err := runner.NewDocker("")
	if err == nil {
		return d
	}
	if os.Getenv("BAY_REQUIRE_DOCKER") == "1" {
		t.Fatalf("BAY_REQUIRE_DOCKER=1 but %v", err)
	}
	t.Skipf("no Docker daemon (%v); set BAY_REQUIRE_DOCKER=1 to make this a failure", err)
	return nil
}

/*
daemonRoot is a data root the daemon can bind-mount (see the runner package's
daemonTempDir for BAY_DOCKER_TESTDIR).

Removed through a container: the app runs as root inside it and writes its
database as root, which a plain RemoveAll by an unprivileged test process
cannot delete on a Linux host.
*/
func daemonRoot(t *testing.T, d *runner.Docker) string {
	t.Helper()
	base := os.Getenv("BAY_DOCKER_TESTDIR")
	if base == "" {
		base = os.TempDir()
	}
	if err := os.MkdirAll(base, 0o755); err != nil {
		t.Fatal(err)
	}
	root, err := os.MkdirTemp(base, "bay-root-")
	if err != nil {
		t.Fatal(err)
	}
	// Resolved, because /tmp is a symlink on macOS and the daemon mounts what
	// the path really is.
	if resolved, err := filepath.EvalSymlinks(root); err == nil {
		root = resolved
	}
	t.Cleanup(func() {
		_, _ = d.RunOnce("busybox:1.37", []string{"rm", "-rf", "/root-to-clean"},
			[]runner.Mount{{Source: root, Target: "/root-to-clean"}}, time.Minute)
		os.RemoveAll(root)
	})
	return root
}

// sqliteAppArtifact is an Alepha-shaped artifact whose app opens its managed
// SQLite database, writes a row, and answers every path as ready.
func sqliteAppArtifact(t *testing.T) string {
	t.Helper()
	files := map[string]string{
		"manifest.json": `{
			"project": "sqlitedemo",
			"runtimes": [{"runtime": "node", "entry": "index.node.js", "runtimeVersion": "26"}],
			"resources": {"hasDatabase": true}
		}`,
		"index.node.js": `
const { DatabaseSync } = require("node:sqlite");
const http = require("node:http");
const db = new DatabaseSync(process.env.DATABASE_URL.replace("sqlite://", ""));
db.exec("CREATE TABLE IF NOT EXISTS hits (n INTEGER)");
db.exec("INSERT INTO hits VALUES (1)");
const fs = require("node:fs");
const denied = (path) => { try { fs.writeFileSync(path, "x"); return false; } catch { return true; } };
const probe = {
  uid: process.getuid(),
  releaseWritable: !denied("/app/escape.txt"),
  rootWritable: !denied("/etc/escape.txt"),
  tmpWritable: !denied("/tmp/scratch.txt"),
};
http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ready: true, host: process.env.SERVER_HOST, ...probe }));
}).listen(Number(process.env.SERVER_PORT), process.env.SERVER_HOST);
`,
	}
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, body := range files {
		if err := tw.WriteHeader(&tar.Header{Name: name, Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(body))}); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	tw.Close()
	gz.Close()
	path := filepath.Join(t.TempDir(), "sqlitedemo.tar.gz")
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestContainerDeployDaemon(t *testing.T) {
	d := daemonDocker(t)
	root := daemonRoot(t, d)
	store, err := state.Open(filepath.Join(root, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetBaseDomain("bay.test"); err != nil {
		t.Fatal(err)
	}
	s := &server{
		root: root, store: store, runner: d, probe: &health.Probe{},
		log:          slog.New(slog.NewTextHandler(io.Discard, nil)),
		keepReleases: defaultKeepReleases,
	}
	env := "e2e" + strconv.FormatInt(time.Now().UnixNano()%1e9, 36)
	key := "sqlitedemo/" + env
	t.Cleanup(func() { _ = d.Remove(key, true) })

	out, failure := s.deployArtifact(context.Background(), deployArtifactOptions{
		Artifact: sqliteAppArtifact(t), Name: "sqlitedemo", Env: env,
	})
	if failure != nil {
		lines, _, _ := d.Logs(key, 50)
		t.Fatalf("deploy: %v\napp logs: %+v", failure, lines)
	}

	t.Run("the app runs in its runtime image, reachable on the host's loopback", func(t *testing.T) {
		if out.Runtime == nil || !strings.HasPrefix(out.Runtime.Image, "node:26-slim@sha256:") {
			t.Fatalf("runtime = %+v", out.Runtime)
		}
		if !d.Running(key) {
			t.Fatal("container not running")
		}
		res, err := http.Get("http://127.0.0.1:" + strconv.Itoa(out.Result.App.Port) + "/")
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		body, _ := io.ReadAll(res.Body)
		if !strings.Contains(string(body), `"host":"0.0.0.0"`) {
			t.Fatalf("body = %s", body)
		}
	})

	t.Run("the app runs hardened: not root, release and root filesystem read-only, /tmp writable", func(t *testing.T) {
		res, err := http.Get("http://127.0.0.1:" + strconv.Itoa(out.Result.App.UpstreamPort()) + "/")
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var probe struct {
			UID             int  `json:"uid"`
			ReleaseWritable bool `json:"releaseWritable"`
			RootWritable    bool `json:"rootWritable"`
			TmpWritable     bool `json:"tmpWritable"`
		}
		if err := json.NewDecoder(res.Body).Decode(&probe); err != nil {
			t.Fatal(err)
		}
		if probe.UID == 0 || probe.ReleaseWritable || probe.RootWritable || !probe.TmpWritable {
			t.Fatalf("probe = %+v", probe)
		}
		if os.Geteuid() == 0 {
			app, _ := store.Get(key)
			if app.UID < 20000 || probe.UID != app.UID {
				t.Fatalf("uid = %d, recorded %d", probe.UID, app.UID)
			}
		}
	})

	t.Run("the SQLite backup reads the database through the app's runtime image", func(t *testing.T) {
		interp, dbPath, err := s.appPaths(out.Result.App)
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := interp.(*imageInterpreter); !ok {
			t.Fatalf("interpreter = %T, want the image interpreter", interp)
		}
		snapDir, err := os.MkdirTemp(root, "snap-")
		if err != nil {
			t.Fatal(err)
		}
		got, err := backup.Snapshot(context.Background(), interp, dbPath, filepath.Join(snapDir, "app.db"))
		if err != nil {
			t.Fatal(err)
		}
		if !got.OK() || got.Tables < 1 {
			t.Fatalf("inspection = %+v", got)
		}
	})
}
