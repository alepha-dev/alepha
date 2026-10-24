package stack

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

/*
Loaded is a compose file read, validated and normalised for one stack
environment, before Bay renders what it will run.
*/
type Loaded struct {
	// Project is the Compose project name, "<stack>-<env>".
	Project string
	// Dir is the revision directory the compose file was read from.
	Dir string
	// Model is the normalised compose model as `docker compose config` emits
	// it, with Bay's rewrites applied by Render.
	Model map[string]any
	// Services lists every service by name, sorted.
	Services []string
	// XLore holds each service's raw `x-lore` field, which Compose itself
	// drops from its normalised output.
	XLore map[string]map[string]any
}

// ComposeCommand is the `docker` binary Compose runs through; a variable so
// the tests can point at a stand-in.
var ComposeCommand = "docker"

/*
Load reads the compose file of a revision directory.

Compose does the parsing, the normalisation (short and long syntaxes, relative
paths, env lists) and the interpolation from the stack environment's variables,
so Bay never disagrees with how `docker compose` itself reads the file. What
Compose drops (`x-lore`) is read from the raw YAML, and what Compose would
silently blank (an unset `${VAR}`) is refused first.

The interpolation sees the variables and nothing of Bay's own environment: a
stack must not read the host's secrets by naming them.
*/
func Load(dir, project string, vars map[string]string) (*Loaded, error) {
	file, err := ComposeFile(dir)
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		return nil, err
	}
	if missing := unsetVariables(string(raw), vars); len(missing) > 0 {
		return nil, fmt.Errorf("the compose file uses %s with no value and no default: set %s with `bay stack env set`, or give a default (${NAME:-value})",
			joinVars(missing), plural(len(missing), "it", "them"))
	}
	xlore, err := readXLore(raw)
	if err != nil {
		return nil, err
	}
	prepared, err := withAppPlaceholders(raw, xlore)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, ComposeCommand, "compose",
		"--project-name", project, "--project-directory", dir, "--file", "-",
		"config", "--format", "json")
	cmd.Stdin = bytes.NewReader(prepared)
	// The variables travel in the process environment, not an env file:
	// Compose's env-file grammar cannot carry every value (a single quote
	// inside a quoted one), and the environment takes precedence over a
	// `.env` the bundle might carry, so the stack's own values always win.
	cmd.Env = append(minimalEnv(), varsEnv(vars)...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("compose refused the file: %s", strings.TrimSpace(stderr.String()))
	}
	var model map[string]any
	if err := json.Unmarshal(out, &model); err != nil {
		return nil, fmt.Errorf("compose config: %w", err)
	}
	services, _ := model["services"].(map[string]any)
	if len(services) == 0 {
		return nil, fmt.Errorf("the compose file declares no service")
	}
	names := make([]string, 0, len(services))
	for name := range services {
		names = append(names, name)
	}
	sort.Strings(names)
	return &Loaded{Project: project, Dir: dir, Model: model, Services: names, XLore: xlore}, nil
}

// minimalEnv is what Compose runs with: enough to find the daemon and its
// plugins, none of Bay's own variables.
func minimalEnv() []string {
	env := []string{"PATH=" + os.Getenv("PATH"), "HOME=" + os.Getenv("HOME")}
	if host := os.Getenv("DOCKER_HOST"); host != "" {
		env = append(env, "DOCKER_HOST="+host)
	}
	return env
}

func varsEnv(vars map[string]string) []string {
	keys := make([]string, 0, len(vars))
	for k := range vars {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]string, 0, len(keys))
	for _, k := range keys {
		out = append(out, k+"="+vars[k])
	}
	return out
}

// variableRef matches a Compose interpolation: $$ (an escaped dollar), ${...}
// or $NAME.
var variableRef = regexp.MustCompile(`\$\$|\$\{([^}]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)`)

/*
unsetVariables lists the variables a compose file needs that have no value and
no default.

Compose itself blanks them with a warning nobody reads, and a service then
starts with an empty password. `${NAME:-x}` and `${NAME-x}` carry a default;
`${NAME:?msg}` and `${NAME?msg}` are required by the file itself.
*/
func unsetVariables(text string, vars map[string]string) []string {
	seen := map[string]bool{}
	var missing []string
	for _, m := range variableRef.FindAllStringSubmatch(text, -1) {
		if m[0] == "$$" {
			continue
		}
		name, hasDefault := m[2], false
		if m[1] != "" || strings.HasPrefix(m[0], "${") {
			inner := m[1]
			i := strings.IndexAny(inner, ":-?")
			if i < 0 {
				name = inner
			} else {
				name = inner[:i]
				op := inner[i:]
				hasDefault = strings.HasPrefix(op, ":-") || strings.HasPrefix(op, "-")
			}
		}
		if name == "" || hasDefault || seen[name] {
			continue
		}
		if _, set := vars[name]; !set {
			seen[name] = true
			missing = append(missing, name)
		}
	}
	sort.Strings(missing)
	return missing
}

func joinVars(names []string) string {
	quoted := make([]string, len(names))
	for i, n := range names {
		quoted[i] = "${" + n + "}"
	}
	return strings.Join(quoted, ", ")
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

/*
withAppPlaceholders gives every app service with no image a placeholder one.

An app service is `x-lore: { app: api }` and nothing more: Bay runs it from the
artifact deployed under that name, so the file has no image to give, and
Compose refuses a service with neither image nor build. The placeholder is
never pulled; Bay takes app services out before Compose runs anything.
*/
func withAppPlaceholders(raw []byte, xlore map[string]map[string]any) ([]byte, error) {
	var doc map[string]any
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("the compose file is not valid YAML: %w", err)
	}
	services, _ := doc["services"].(map[string]any)
	changed := false
	for name, x := range xlore {
		if _, isApp := x["app"]; !isApp {
			continue
		}
		svc, _ := services[name].(map[string]any)
		if svc == nil {
			continue
		}
		if _, ok := svc["image"]; !ok {
			svc["image"] = appPlaceholderImage
			changed = true
		}
	}
	if !changed {
		return raw, nil
	}
	return yaml.Marshal(doc)
}

// appPlaceholderImage stands in for an app service's image while Compose
// reads the file.
const appPlaceholderImage = "bay.invalid/app-service"

// readXLore extracts each service's `x-lore` from the raw YAML.
func readXLore(raw []byte) (map[string]map[string]any, error) {
	var doc struct {
		Services map[string]map[string]any `yaml:"services"`
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("the compose file is not valid YAML: %w", err)
	}
	out := map[string]map[string]any{}
	for name, svc := range doc.Services {
		if x, ok := svc["x-lore"]; ok {
			m, ok := x.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("service %s: x-lore must be a mapping", name)
			}
			out[name] = m
		}
	}
	return out, nil
}

/*
Validate refuses what would let a stack collide with another or reach past
its own boundary, each with the service and the key.

  - container_name: Bay names every container after the stack environment; a
    fixed name collides as soon as there is a second environment
  - privileged, network_mode/pid/ipc/userns_mode host: the host itself
  - the Docker socket mounted: root on the host
  - a bind mount outside the bundle, or of a path the bundle does not carry
  - build: Bay runs images and archives, it builds nothing on the host
*/
func (l *Loaded) Validate() error {
	var problems []string
	services, _ := l.Model["services"].(map[string]any)
	for _, name := range l.Services {
		svc, _ := services[name].(map[string]any)
		say := func(format string, args ...any) {
			problems = append(problems, fmt.Sprintf("service %s: ", name)+fmt.Sprintf(format, args...))
		}
		if _, ok := svc["container_name"]; ok {
			say("container_name is not allowed: Bay names containers after the stack environment, so staging and production never collide")
		}
		if _, ok := svc["build"]; ok {
			say("build is not allowed: Bay builds nothing on the host; push an image or an archive instead")
		}
		if p, _ := svc["privileged"].(bool); p {
			say("privileged is not allowed on Bay")
		}
		for _, key := range []string{"network_mode", "pid", "ipc", "userns_mode"} {
			if v, _ := svc[key].(string); v == "host" {
				say("%s: host is not allowed on Bay", key)
			}
		}
		_, isApp := l.XLore[name]["app"]
		if _, hasImage := svc["image"]; !hasImage && !isApp {
			say("has no image (and is not an x-lore app)")
		}
		volumes, _ := svc["volumes"].([]any)
		for _, v := range volumes {
			vol, _ := v.(map[string]any)
			if vol["type"] != "bind" {
				continue
			}
			src, _ := vol["source"].(string)
			if src == "/var/run/docker.sock" || strings.HasSuffix(src, "/docker.sock") {
				say("mounting the Docker socket is not allowed: it is root on the host")
				continue
			}
			rel, err := filepath.Rel(l.Dir, src)
			if err != nil || rel == ".." || strings.HasPrefix(rel, "../") || filepath.IsAbs(rel) {
				say("bind mount %s is outside the bundle: only files the bundle carries can be mounted", src)
				continue
			}
			if _, err := os.Stat(src); err != nil {
				say("bind mount ./%s is not in the bundle: add it next to the compose file", rel)
			}
		}
	}
	if len(problems) > 0 {
		return fmt.Errorf("the compose file cannot run on Bay:\n  %s", strings.Join(problems, "\n  "))
	}
	return nil
}

// PublishedPort is a container port a service published, as Bay rewrote it.
type PublishedPort struct {
	Target   int
	HostPort int
}

/*
RewritePorts publishes every port on the host's loopback, on a port that stays
the same across redeploys.

Docker publishes on every interface by default and its iptables rules run
before the host firewall's, so `"3000:3000"` would put the service on the
internet past UFW; and two environments asking for host port 3000 would clash.
The host port a file asked for is ignored on purpose: Bay's proxy is the only
public entrance, and the loopback port is what it routes to.
*/
func (l *Loaded) RewritePorts(allocate func(service string, target int) (int, error)) (map[string][]PublishedPort, error) {
	out := map[string][]PublishedPort{}
	services, _ := l.Model["services"].(map[string]any)
	for _, name := range l.Services {
		svc, _ := services[name].(map[string]any)
		ports, _ := svc["ports"].([]any)
		for _, p := range ports {
			port, _ := p.(map[string]any)
			target := toInt(port["target"])
			if target == 0 {
				continue
			}
			host, err := allocate(name, target)
			if err != nil {
				return nil, err
			}
			port["host_ip"] = "127.0.0.1"
			port["published"] = strconv.Itoa(host)
			out[name] = append(out[name], PublishedPort{Target: target, HostPort: host})
		}
	}
	return out, nil
}

func toInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case string:
		i, _ := strconv.Atoi(n)
		return i
	}
	return 0
}

/*
PinImages resolves every service's image to a digest and writes it back into
the model, answering service -> pinned reference for the revision record.

`latest`, and every tag, means whatever the registry serves today; pinned, a
rollback pulls exactly what ran. A reference already carrying a digest is kept
as is.
*/
func (l *Loaded) PinImages(resolve func(image string) (string, error)) (map[string]string, error) {
	pinned := map[string]string{}
	services, _ := l.Model["services"].(map[string]any)
	for _, name := range l.Services {
		if _, isApp := l.XLore[name]["app"]; isApp {
			// Bay runs it from its artifact; its image here is a placeholder.
			continue
		}
		svc, _ := services[name].(map[string]any)
		image, _ := svc["image"].(string)
		if image == "" {
			continue
		}
		ref := image
		if !strings.Contains(image, "@sha256:") {
			var err error
			if ref, err = resolve(image); err != nil {
				return nil, fmt.Errorf("service %s: %w", name, err)
			}
		}
		svc["image"] = ref
		pinned[name] = ref
	}
	return pinned, nil
}
