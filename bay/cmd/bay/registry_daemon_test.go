package main

import (
	"context"
	"encoding/base64"
	"fmt"
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

	"golang.org/x/crypto/bcrypt"

	"github.com/alepha-dev/bay/internal/health"
	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/runner"
	"github.com/alepha-dev/bay/internal/stack"
	"github.com/alepha-dev/bay/internal/state"
)

func TestPrivateRegistryDaemon(t *testing.T) {
	d := daemonDocker(t)
	requireComposeCLI(t)
	root := daemonRoot(t, d)

	// A registry that refuses anonymous pulls, published on loopback.
	authDir := filepath.Join(root, "registry-auth")
	_ = os.MkdirAll(authDir, 0o755)
	hash, _ := bcrypt.GenerateFromPassword([]byte("s3cret"), bcrypt.DefaultCost)
	if err := os.WriteFile(filepath.Join(authDir, "htpasswd"), []byte("ci:"+string(hash)+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	registryKey := "bay-registry-test/r" + strconv.FormatInt(time.Now().UnixNano()%1e9, 36)
	port := freeLoopbackPort(t)
	t.Cleanup(func() { _ = d.Remove(registryKey, true) })
	err := d.Start(runner.Spec{Key: registryKey, Env: map[string]string{
		"REGISTRY_AUTH":                "htpasswd",
		"REGISTRY_AUTH_HTPASSWD_REALM": "bay",
		"REGISTRY_AUTH_HTPASSWD_PATH":  "/auth/htpasswd",
	}, Sandbox: runner.Container{Image: "registry:2", Port: 5000, HostPort: port,
		Mounts: []runner.Mount{{Source: authDir, Target: "/auth", ReadOnly: true}}}})
	if err != nil {
		t.Fatal(err)
	}
	waitForHTTP(t, "http://127.0.0.1:"+strconv.Itoa(port)+"/v2/")

	// Push busybox into it, under a name only the credential can pull.
	repo := "localhost:" + strconv.Itoa(port) + "/team/web"
	cliConfig := t.TempDir()
	auth := base64.StdEncoding.EncodeToString([]byte("ci:s3cret"))
	_ = os.WriteFile(filepath.Join(cliConfig, "config.json"),
		[]byte(`{"auths":{"localhost:`+strconv.Itoa(port)+`":{"auth":"`+auth+`"}}}`), 0o600)
	for _, args := range [][]string{
		{"pull", "busybox:1.37"},
		{"tag", "busybox:1.37", repo + ":1"},
		{"--config", cliConfig, "push", repo + ":1"},
		{"rmi", repo + ":1"},
	} {
		if out, err := exec.Command("docker", args...).CombinedOutput(); err != nil {
			t.Fatalf("docker %v: %v\n%s", args, err, out)
		}
	}

	store, _ := state.Open(filepath.Join(root, "state.json"))
	_ = store.SetBaseDomain("bay.test")
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	s := &server{root: root, store: store, runner: d, probe: &health.Probe{}, log: log, keepReleases: defaultKeepReleases}
	env := "rg" + strconv.FormatInt(time.Now().UnixNano()%1e9, 36)
	t.Cleanup(func() { _ = stack.Down(stack.Dir(root, "private", env), naming.StackProject("private", env), true) })
	compose := fmt.Sprintf("services:\n  web:\n    image: %s:1\n    command: [\"httpd\", \"-f\", \"-p\", \"8080\"]\n", repo)
	bundles := t.TempDir()

	t.Run("an image from a private registry is refused without the stack's credential", func(t *testing.T) {
		_, err := s.deployStack(context.Background(), stackDeployOptions{Stack: "private", Env: env,
			Bundle: tarGz(t, bundles, "r1.tar.gz", map[string]string{"compose.yml": compose})})
		if err == nil {
			t.Fatal("a private image deployed with no credential")
		}
	})

	t.Run("with the credential stored for the stack, it deploys", func(t *testing.T) {
		rec := httptest.NewRecorder()
		s.controlMux().ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/stacks/private/"+env+"/registries",
			strings.NewReader(`{"host": "localhost:`+strconv.Itoa(port)+`", "username": "ci", "password": "s3cret"}`)))
		if rec.Code != 200 {
			t.Fatalf("%d %s", rec.Code, rec.Body.String())
		}
		out, err := s.deployStack(context.Background(), stackDeployOptions{Stack: "private", Env: env,
			Bundle: tarGz(t, bundles, "r2.tar.gz", map[string]string{"compose.yml": compose})})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(out.Digests["web"].(string), repo+":1@sha256:") {
			t.Fatalf("digests = %v", out.Digests)
		}
		if !d.Running(memberKey("private", env, "web")) {
			t.Fatal("web is not running")
		}
	})

	t.Run("another environment does not get the credential", func(t *testing.T) {
		if hosts, _ := stack.RegistryHosts(root, "private", env+"x"); len(hosts) != 0 {
			t.Fatalf("hosts = %v", hosts)
		}
	})
}

func freeLoopbackPort(t *testing.T) int {
	t.Helper()
	p, err := freePortOnLoopback()
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func waitForHTTP(t *testing.T, url string) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if res, err := http.Get(url); err == nil {
			res.Body.Close()
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatalf("%s never answered", url)
}

func freePortOnLoopback() (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port, nil
}
