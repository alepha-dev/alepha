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
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/health"
	"github.com/alepha-dev/bay/internal/proxy"
	"github.com/alepha-dev/bay/internal/state"
)

// versionedArtifact is a Node app that answers every path with its version,
// or one that crashes on boot when `version` is "crash".
func versionedArtifact(t *testing.T, version string) string {
	t.Helper()
	app := `
const http = require("node:http");
http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ready: true, version: "` + version + `" }));
}).listen(Number(process.env.SERVER_PORT), process.env.SERVER_HOST);
`
	if version == "crash" {
		app = `console.error("refusing to boot"); process.exit(1);`
	}
	files := map[string]string{
		"manifest.json": `{"project": "bluegreen", "runtimes": [{"runtime": "node", "entry": "index.node.js", "runtimeVersion": "26"}]}`,
		"index.node.js": app,
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
	path := filepath.Join(t.TempDir(), version+".tar.gz")
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

// load sends requests through the proxy until stopped, counting what did not
// come back as a 200, and remembering the last version seen.
type load struct {
	ok, failed atomic.Int64
	last       atomic.Value
	stop       chan struct{}
	done       sync.WaitGroup
}

func startLoad(t *testing.T, front *httptest.Server, host string) *load {
	l := &load{stop: make(chan struct{})}
	l.last.Store("")
	client := &http.Client{Timeout: 30 * time.Second}
	for w := 0; w < 4; w++ {
		l.done.Add(1)
		go func() {
			defer l.done.Done()
			for {
				select {
				case <-l.stop:
					return
				default:
				}
				req, _ := http.NewRequest(http.MethodGet, front.URL+"/", nil)
				req.Host = host
				res, err := client.Do(req)
				if err != nil {
					l.failed.Add(1)
					continue
				}
				body, _ := io.ReadAll(res.Body)
				res.Body.Close()
				if res.StatusCode != http.StatusOK {
					l.failed.Add(1)
					continue
				}
				l.ok.Add(1)
				l.last.Store(string(body))
				time.Sleep(5 * time.Millisecond)
			}
		}()
	}
	return l
}

func (l *load) finish() { close(l.stop); l.done.Wait() }

func TestBlueGreenDaemon(t *testing.T) {
	d := daemonDocker(t)
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
	s := &server{
		root: root, store: store, runner: d, probe: &health.Probe{}, log: log,
		router: router, keepReleases: defaultKeepReleases, readyWait: 10 * time.Second,
	}
	front := httptest.NewServer(router)
	defer front.Close()

	env := "bg" + strconv.FormatInt(time.Now().UnixNano()%1e9, 36)
	key := "bluegreen/" + env
	t.Cleanup(func() {
		_ = d.Remove(key, true)
		_ = d.DiscardCandidate(key)
	})
	deployVersion := func(version string) (*deployOutcome, *deployFailure) {
		return s.deployArtifact(context.Background(), deployArtifactOptions{
			Artifact: versionedArtifact(t, version), Name: "bluegreen", Env: env,
		})
	}

	out, failure := deployVersion("v1")
	if failure != nil {
		t.Fatalf("first deploy: %v", failure)
	}
	host := out.Result.App.Domain()
	firstPort := out.Result.App.UpstreamPort()
	firstRelease := out.Result.Release

	t.Run("a redeploy under load loses no request and switches to the new release", func(t *testing.T) {
		l := startLoad(t, front, host)
		time.Sleep(300 * time.Millisecond)
		if _, failure := deployVersion("v2"); failure != nil {
			l.finish()
			t.Fatalf("redeploy: %v", failure)
		}
		time.Sleep(300 * time.Millisecond)
		l.finish()

		if l.failed.Load() != 0 {
			t.Fatalf("%d of %d requests failed during the switch", l.failed.Load(), l.ok.Load()+l.failed.Load())
		}
		if !strings.Contains(l.last.Load().(string), `"version":"v2"`) {
			t.Fatalf("last answer = %s", l.last.Load())
		}
		app, _ := store.Get(key)
		if app.UpstreamPort() == firstPort {
			t.Fatalf("host port did not move: %d", firstPort)
		}
		if _, found, _ := d.Logs(key, 1); !found {
			t.Fatal("the promoted container does not carry the instance's name")
		}
		if d.Running(key) == false {
			t.Fatal("instance not running after the switch")
		}
		t.Logf("%d requests, none failed", l.ok.Load())
	})

	t.Run("a release that never becomes ready is never switched to", func(t *testing.T) {
		before, _ := store.Get(key)
		l := startLoad(t, front, host)
		_, failure := deployVersion("crash")
		time.Sleep(200 * time.Millisecond)
		l.finish()

		if failure == nil {
			t.Fatal("a crashing release deployed successfully")
		}
		if failure.Detail["running"] != true {
			t.Fatalf("detail = %v", failure.Detail)
		}
		if l.failed.Load() != 0 || !strings.Contains(l.last.Load().(string), `"version":"v2"`) {
			t.Fatalf("failed = %d, last = %s", l.failed.Load(), l.last.Load())
		}
		after, _ := store.Get(key)
		if after.Release != before.Release || after.UpstreamPort() != before.UpstreamPort() {
			t.Fatalf("store moved: before %+v, after %+v", before, after)
		}
	})

	t.Run("a restart is blue/green too", func(t *testing.T) {
		before, _ := store.Get(key)
		l := startLoad(t, front, host)
		if err := s.restart(before); err != nil {
			l.finish()
			t.Fatal(err)
		}
		time.Sleep(200 * time.Millisecond)
		l.finish()
		after, _ := store.Get(key)
		if l.failed.Load() != 0 || after.UpstreamPort() == before.UpstreamPort() {
			t.Fatalf("failed = %d, port %d -> %d", l.failed.Load(), before.UpstreamPort(), after.UpstreamPort())
		}
	})

	t.Run("a rollback to the previous release is blue/green, as the health watch runs it", func(t *testing.T) {
		app, _ := store.Get(key)
		l := startLoad(t, front, host)
		if err := s.rollbackTo(app, firstRelease); err != nil {
			l.finish()
			t.Fatal(err)
		}
		time.Sleep(200 * time.Millisecond)
		l.finish()
		after, _ := store.Get(key)
		if l.failed.Load() != 0 || after.Release != firstRelease || !strings.Contains(l.last.Load().(string), `"version":"v1"`) {
			t.Fatalf("failed = %d, release = %s, last = %s", l.failed.Load(), after.Release, l.last.Load())
		}
	})
}
