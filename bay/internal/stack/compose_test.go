package stack

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// requireCompose fails under BAY_REQUIRE_DOCKER=1 when `docker compose` is
// missing, and skips otherwise, like the runner's requireDocker.
func requireCompose(t *testing.T) {
	t.Helper()
	if err := exec.Command(ComposeCommand, "compose", "version").Run(); err != nil {
		if os.Getenv("BAY_REQUIRE_DOCKER") == "1" {
			t.Fatalf("BAY_REQUIRE_DOCKER=1 but docker compose is not available: %v", err)
		}
		t.Skipf("docker compose is not available (%v)", err)
	}
}

func bundleDir(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(dir); err == nil {
		dir = resolved
	}
	for name, body := range files {
		path := filepath.Join(dir, name)
		_ = os.MkdirAll(filepath.Dir(path), 0o755)
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

const umamiCompose = `---
services:
  umami:
    image: ghcr.io/umami-software/umami:latest
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://umami:umami@db:5432/umami
      APP_SECRET: replace-me-with-a-random-string
    depends_on:
      db:
        condition: service_healthy
    init: true
    restart: always
    healthcheck:
      test: ["CMD-SHELL", "curl http://localhost:3000/api/heartbeat"]
      interval: 5s
      timeout: 5s
      retries: 5
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: umami
      POSTGRES_USER: umami
      POSTGRES_PASSWORD: umami
    volumes:
      - umami-db-data:/var/lib/postgresql/data
    restart: always
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 5
volumes:
  umami-db-data:
`

func TestUnsetVariables(t *testing.T) {
	text := "a: ${SET}\nb: ${MISSING}\nc: ${DEF:-x}\nd: ${DEF2-x}\ne: $BARE\nf: $$ESCAPED\ng: ${REQ:?need it}\nh: ${MISSING}"
	got := unsetVariables(text, map[string]string{"SET": "1"})
	if strings.Join(got, ",") != "BARE,MISSING,REQ" {
		t.Fatalf("missing = %v", got)
	}
}

func TestReadXLore(t *testing.T) {
	x, err := readXLore([]byte("services:\n  api:\n    x-lore:\n      app: api\n      routes: ['@']\n  db:\n    image: postgres\n"))
	if err != nil {
		t.Fatal(err)
	}
	if x["api"]["app"] != "api" || len(x["api"]["routes"].([]any)) != 1 {
		t.Fatalf("x-lore = %v", x)
	}
	if _, ok := x["db"]; ok {
		t.Fatal("db has no x-lore")
	}
	if _, err := readXLore([]byte("services:\n  api:\n    x-lore: yes\n")); err == nil {
		t.Fatal("a scalar x-lore was accepted")
	}
}

func TestLoad(t *testing.T) {
	requireCompose(t)

	t.Run("the official Umami file loads and validates unmodified", func(t *testing.T) {
		dir := bundleDir(t, map[string]string{"compose.yml": umamiCompose})
		l, err := Load(dir, "umami-production", nil)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Join(l.Services, ",") != "db,umami" {
			t.Fatalf("services = %v", l.Services)
		}
		if err := l.Validate(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("published ports move to stable loopback ports", func(t *testing.T) {
		dir := bundleDir(t, map[string]string{"compose.yml": umamiCompose})
		l, _ := Load(dir, "umami-production", nil)
		published, err := l.RewritePorts(func(service string, target int) (int, error) { return 41000 + target, nil })
		if err != nil {
			t.Fatal(err)
		}
		if p := published["umami"]; len(p) != 1 || p[0].Target != 3000 || p[0].HostPort != 44000 {
			t.Fatalf("published = %v", published)
		}
		port := l.Model["services"].(map[string]any)["umami"].(map[string]any)["ports"].([]any)[0].(map[string]any)
		if port["host_ip"] != "127.0.0.1" || port["published"] != "44000" {
			t.Fatalf("port = %v", port)
		}
	})

	t.Run("tags are pinned to digests, a digest is kept", func(t *testing.T) {
		dir := bundleDir(t, map[string]string{"compose.yml": "services:\n  a:\n    image: nginx:1\n  b:\n    image: busybox@sha256:abc\n"})
		l, _ := Load(dir, "p-production", nil)
		pinned, err := l.PinImages(func(image string) (string, error) { return image + "@sha256:pinned", nil })
		if err != nil {
			t.Fatal(err)
		}
		if pinned["a"] != "nginx:1@sha256:pinned" || pinned["b"] != "busybox@sha256:abc" {
			t.Fatalf("pinned = %v", pinned)
		}
	})

	t.Run("variables interpolate from the stack only, and an unset one is refused", func(t *testing.T) {
		dir := bundleDir(t, map[string]string{"compose.yml": "services:\n  a:\n    image: nginx\n    environment:\n      SECRET: ${SECRET}\n"})
		if _, err := Load(dir, "p-production", nil); err == nil || !strings.Contains(err.Error(), "${SECRET}") {
			t.Fatalf("err = %v", err)
		}
		l, err := Load(dir, "p-production", map[string]string{"SECRET": "it's 'quoted'"})
		if err != nil {
			t.Fatal(err)
		}
		env := l.Model["services"].(map[string]any)["a"].(map[string]any)["environment"].(map[string]any)
		if env["SECRET"] != "it's 'quoted'" {
			t.Fatalf("SECRET = %v", env["SECRET"])
		}
	})

	t.Run("what would collide or reach the host is refused, naming the service and the key", func(t *testing.T) {
		dir := bundleDir(t, map[string]string{"compose.yml": `services:
  a:
    image: nginx
    container_name: fixed
    privileged: true
    network_mode: host
  b:
    build: .
  c:
    image: nginx
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /etc:/host-etc
      - ./missing.conf:/etc/x.conf
`})
		l, err := Load(dir, "p-production", nil)
		if err != nil {
			t.Fatal(err)
		}
		err = l.Validate()
		if err == nil {
			t.Fatal("expected refusals")
		}
		for _, want := range []string{"service a: container_name", "service a: privileged", "service a: network_mode: host",
			"service b: build", "service c: mounting the Docker socket", "service c: bind mount /etc", "service c: bind mount ./missing.conf"} {
			if !strings.Contains(err.Error(), want) {
				t.Errorf("refusal missing %q in:\n%v", want, err)
			}
		}
	})

	t.Run("a bundled config file mounts", func(t *testing.T) {
		dir := bundleDir(t, map[string]string{
			"compose.yml":    "services:\n  mqtt:\n    image: eclipse-mosquitto:2\n    volumes:\n      - ./mosquitto.conf:/mosquitto/config/mosquitto.conf:ro\n",
			"mosquitto.conf": "listener 1883\nallow_anonymous true\n",
		})
		l, err := Load(dir, "broker-production", nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := l.Validate(); err != nil {
			t.Fatal(err)
		}
	})
}

func TestVolumeMounts(t *testing.T) {
	t.Run("named volumes map to the services mounting them; binds and anonymous volumes are left out", func(t *testing.T) {
		l := &Loaded{Services: []string{"api", "db"}, Model: map[string]any{
			"volumes": map[string]any{"pgdata": map[string]any{}, "unused": map[string]any{}},
			"services": map[string]any{
				"db": map[string]any{"volumes": []any{
					map[string]any{"type": "volume", "source": "pgdata", "target": "/var/lib/postgresql/data"},
					map[string]any{"type": "bind", "source": "./init.sql", "target": "/init.sql"},
				}},
				"api": map[string]any{"volumes": []any{
					map[string]any{"type": "volume", "source": "pgdata", "target": "/ro"},
					map[string]any{"type": "volume", "target": "/tmp/scratch"},
				}},
			},
		}}
		got := l.VolumeMounts()
		if strings.Join(got["pgdata"], ",") != "api,db" || got["unused"] != nil || len(got) != 2 {
			t.Fatalf("mounts = %v", got)
		}
	})
}
