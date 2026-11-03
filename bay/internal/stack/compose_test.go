package stack

import (
	"fmt"
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
		pinned, err := l.PinImages(func(image string) (string, error) { return image + "@sha256:pinned", nil }, nil)
		if err != nil {
			t.Fatal(err)
		}
		if pinned["a"] != "nginx:1@sha256:pinned" || pinned["b"] != "busybox@sha256:abc" {
			t.Fatalf("pinned = %v", pinned)
		}
	})

	t.Run("pull_policy never pins what the host holds, and pulls nothing", func(t *testing.T) {
		dir := bundleDir(t, map[string]string{"compose.yml": "services:\n  a:\n    image: nginx:1\n    pull_policy: never\n"})
		l, err := Load(dir, "p-production", nil)
		if err != nil {
			t.Fatal(err)
		}
		pinned, err := l.PinImages(
			func(image string) (string, error) { return "", fmt.Errorf("%s was pulled", image) },
			func(string) (string, error) { return "sha256:local", nil },
		)
		if err != nil {
			t.Fatal(err)
		}
		if pinned["a"] != "sha256:local" {
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

	t.Run("a named volume keeps the name Compose gives it, however the file spells another", func(t *testing.T) {
		requireCompose(t)
		service := "services:\n  web:\n    image: nginx\n    volumes: [\"data:/data\"]\n"
		for _, c := range []struct{ name, top, refused string }{
			{name: "no name", top: "volumes:\n  data: {}\n"},
			{name: "external false", top: "volumes:\n  data: {external: false}\n"},
			{name: "the default spelled out", top: "volumes:\n  data: {name: p-staging_data}\n"},
			{name: "another environment's", top: "volumes:\n  data: {name: p-production_data}\n", refused: "volume data: name is not allowed"},
			{name: "from a default value", top: "volumes:\n  data: {name: \"${V:-p-production_data}\"}\n", refused: "volume data: name is not allowed"},
			{name: "external", top: "volumes:\n  data: {external: true}\n", refused: "volume data: external is not allowed"},
			{name: "external through the old spelling", top: "volumes:\n  data: {external: {name: p-production_data}}\n", refused: "volume data: external is not allowed"},
		} {
			t.Run(c.name, func(t *testing.T) {
				l, err := Load(bundleDir(t, map[string]string{"compose.yml": service + c.top}), "p-staging", nil)
				if err != nil {
					t.Fatal(err)
				}
				err = l.Validate()
				if c.refused == "" {
					if err != nil {
						t.Fatal(err)
					}
					return
				}
				if err == nil || !strings.Contains(err.Error(), c.refused) {
					t.Fatalf("err = %v, want %q", err, c.refused)
				}
				if strings.Count(err.Error(), "volume data:") != 1 {
					t.Fatalf("one volume, one refusal: %v", err)
				}
			})
		}
	})

	t.Run("a stack names its own services, networks and the files it carries", func(t *testing.T) {
		requireCompose(t)
		dir := bundleDir(t, map[string]string{
			"compose.yml": `services:
  db: {image: nginx, networks: [backend]}
  sidecar:
    image: nginx
    network_mode: "service:db"
    pid: "service:db"
    ipc: "service:db"
  web:
    image: nginx
    networks: [backend]
    volumes_from: [db]
    env_file:
      - ./app.env
      - {path: ./optional.env, required: false}
    secrets: [key, fromenv]
    configs: [conf, inline]
networks:
  backend: {driver: bridge}
secrets:
  key: {file: ./key.txt}
  fromenv: {environment: SECRET}
configs:
  conf: {file: ./conf.txt}
  inline: {content: hello}
`,
			"app.env": "A=1\n", "key.txt": "k\n", "conf.txt": "c\n",
		})
		l, err := Load(dir, "p-production", nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := l.Validate(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("a variable cannot configure Compose itself", func(t *testing.T) {
		dir := bundleDir(t, map[string]string{"compose.yml": "services:\n  web: {image: nginx}\n"})
		_, err := Load(dir, "p-staging", map[string]string{"COMPOSE_ENV_FILES": "/opt/bay/data/stacks/p-production/.env"})
		if err == nil || !strings.Contains(err.Error(), "variable COMPOSE_ENV_FILES is not allowed") {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("an env_file is refused before Compose can read it", func(t *testing.T) {
		secret := filepath.Join(t.TempDir(), "other-env", ".env")
		_ = os.MkdirAll(filepath.Dir(secret), 0o755)
		_ = os.WriteFile(secret, []byte("DB_PASSWORD=production\n"), 0o600)
		outside := "service web: env_file " + secret + " is outside the bundle"
		for _, c := range []struct{ name, service, refused string }{
			{"as one path", "env_file: " + secret, outside},
			{"in a list", "env_file: [" + secret + "]", outside},
			{"optional", "env_file:\n      - {path: " + secret + ", required: false}", outside},
			{"up from the bundle", "env_file: [../x.env]", "service web: env_file ../x.env is outside the bundle"},
			{"from the home directory", "env_file:\n      - {path: ~/x.env, required: false}", "service web: env_file ~/x.env is outside the bundle"},
			{"through a variable", "env_file: [\"${F:-" + secret + "}\"]", "cannot use a variable"},
			{"through an anchor", "env_file: *f", outside},
		} {
			t.Run(c.name, func(t *testing.T) {
				dir := bundleDir(t, map[string]string{
					"compose.yml": "x-f: &f [" + secret + "]\nservices:\n  web:\n    image: nginx\n    " + c.service + "\n"})
				if _, err := Load(dir, "p-staging", nil); err == nil || !strings.Contains(err.Error(), c.refused) {
					t.Fatalf("err = %v, want %q", err, c.refused)
				}
			})
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
