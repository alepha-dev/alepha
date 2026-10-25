package main

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/alepha-dev/bay/internal/health"
	"github.com/alepha-dev/bay/internal/proxy"
	"github.com/alepha-dev/bay/internal/state"
)

// imageAppTag is a small public image that serves HTTP on port 80 and declares
// no HEALTHCHECK, so the test sees both the declared-path and the TCP rules.
const imageAppTag = "nginx:1.29-alpine"

func TestImageAppDaemon(t *testing.T) {
	d := daemonDocker(t)
	ref, err := d.ResolveDigest(imageAppTag)
	if err != nil {
		t.Fatal(err)
	}
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
		router: router, keepReleases: defaultKeepReleases, readyWait: 8 * time.Second}
	front := httptest.NewServer(router)
	defer front.Close()

	env := "img" + strconv.FormatInt(time.Now().UnixNano()%1e9, 36)
	key := "webimage/" + env
	t.Cleanup(func() {
		_ = d.Remove(key, true)
		_ = d.DiscardCandidate(key)
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

	t.Run("an image deploys by digest, ready by its declared path, served through the proxy", func(t *testing.T) {
		app, failure := s.deployImage(context.Background(), imageDeployOptions{
			Name: "webimage", Env: env, Image: ref, ContainerPort: 80, HealthPath: "/",
		})
		if failure != nil {
			t.Fatalf("deploy: %v", failure)
		}
		if app.HealthCheck != "path /" || app.Image != ref {
			t.Fatalf("app = %+v", app)
		}
		status, body := get(app.Domain())
		if status != 200 || !strings.Contains(body, "nginx") {
			t.Fatalf("status = %d, body = %.80s", status, body)
		}
	})

	t.Run("a redeploy is blue/green, and without a path readiness is only a connect, said so", func(t *testing.T) {
		before, _ := store.Get(key)
		app, failure := s.deployImage(context.Background(), imageDeployOptions{
			Name: "webimage", Env: env, Image: ref, ContainerPort: 80,
		})
		if failure != nil {
			t.Fatalf("redeploy: %v", failure)
		}
		if app.HealthCheck != "tcp" || app.UpstreamPort() == before.UpstreamPort() {
			t.Fatalf("check = %q, port %d -> %d", app.HealthCheck, before.UpstreamPort(), app.UpstreamPort())
		}
		if status, _ := get(app.Domain()); status != 200 {
			t.Fatalf("status = %d after the switch", status)
		}
	})

	t.Run("a tag without a digest is refused before anything moves", func(t *testing.T) {
		before, _ := store.Get(key)
		_, failure := s.deployImage(context.Background(), imageDeployOptions{
			Name: "webimage", Env: env, Image: imageAppTag, ContainerPort: 80,
		})
		if failure == nil || failure.Status != http.StatusBadRequest {
			t.Fatalf("failure = %v", failure)
		}
		after, _ := store.Get(key)
		if after.Image != before.Image || after.UpstreamPort() != before.UpstreamPort() {
			t.Fatalf("store moved: %+v", after)
		}
	})

	t.Run("an image that never answers its path is never switched to, and the record goes back", func(t *testing.T) {
		before, _ := store.Get(key)
		_, failure := s.deployImage(context.Background(), imageDeployOptions{
			Name: "webimage", Env: env, Image: ref, ContainerPort: 80, HealthPath: "/does-not-exist",
		})
		if failure == nil {
			t.Fatal("a release that never answered 2xx deployed")
		}
		after, _ := store.Get(key)
		if after.HealthPath != before.HealthPath || after.UpstreamPort() != before.UpstreamPort() {
			t.Fatalf("record not restored: before %+v, after %+v", before, after)
		}
		if status, _ := get(after.Domain()); status != 200 {
			t.Fatalf("status = %d: the previous container stopped serving", status)
		}
	})
}
