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
	// Prepared is the compose file as Compose reads it: the user's, with a
	// placeholder image on app services that have none.
	Prepared []byte
	// Vars are the variables the file was interpolated with.
	Vars map[string]string
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
silently blank (an unset `${VAR}`) is refused first, as is what it would act on
while reading (refusedBeforeCompose).

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
	problems, err := refusedBeforeCompose(raw, dir)
	if err != nil {
		return nil, err
	}
	// The variables are Compose's process environment, and it reads its own
	// settings from there: COMPOSE_ENV_FILES names a file to interpolate from.
	for _, key := range sortedKeysOf(vars) {
		if strings.HasPrefix(key, "COMPOSE_") {
			problems = append(problems, fmt.Sprintf("variable %s is not allowed: a COMPOSE_ name configures Compose itself: unset it with `bay stack env unset`", key))
		}
	}
	if len(problems) > 0 {
		return nil, fmt.Errorf("the compose file cannot run on Bay:\n  %s", strings.Join(problems, "\n  "))
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
	return &Loaded{Project: project, Dir: dir, Model: model, Services: names, XLore: xlore,
		Prepared: prepared, Vars: vars}, nil
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
	keys := sortedKeysOf(vars)
	out := make([]string, 0, len(keys))
	for _, k := range keys {
		out = append(out, k+"="+vars[k])
	}
	return out
}

func sortedKeysOf(vars map[string]string) []string {
	keys := make([]string, 0, len(vars))
	for k := range vars {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
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
refusedBeforeCompose lists what must be refused from the raw YAML, before
Compose reads the file.

Compose acts on these while it reads: it follows `include` and `extends.file`,
and resolves every `env_file` into `environment`, which leaves no trace of the
file in the model Validate reads. A stack's variables are a plain file on the
host, so each of these reads another environment's, and `include` does it in
several spellings (`env_file`, `project_directory`, nested in the included
file). Asking Compose to leave env files alone is no answer:
`--no-env-resolution` is accepted and does nothing on Compose 2.38.

Refusing `include` and `extends.file` makes this one file the whole story, so
every `env_file` is here to be seen. A path holding a variable is refused too:
the raw text is not where it points.
*/
func refusedBeforeCompose(raw []byte, dir string) ([]string, error) {
	var doc struct {
		Include  any            `yaml:"include"`
		Services map[string]any `yaml:"services"`
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("the compose file is not valid YAML: %w", err)
	}
	var problems []string
	if doc.Include != nil {
		problems = append(problems, "include is not allowed: Bay reads one compose file, and an include can read another environment's variables")
	}
	for _, name := range sortedKeys(doc.Services) {
		svc, _ := doc.Services[name].(map[string]any)
		say := func(format string, args ...any) {
			problems = append(problems, fmt.Sprintf("service %s: ", name)+fmt.Sprintf(format, args...))
		}
		if extends, _ := svc["extends"].(map[string]any); extends["file"] != nil {
			say("extends.file is not allowed: Bay reads one compose file; extend a service of this one")
		}
		for _, f := range envFiles(svc["env_file"]) {
			if strings.Contains(f.path, "$") {
				say("env_file %s cannot use a variable: Bay has to see where it points", f.path)
			} else if p := bundleProblem(dir, "env_file", f.path, f.optional); p != "" {
				say("%s", p)
			}
		}
	}
	return problems, nil
}

// envFile is one entry of a service's `env_file`.
type envFile struct {
	path     string
	optional bool
}

// envFiles reads `env_file` in each of its spellings: a path, a list of paths,
// or a list of `{path, required}`.
func envFiles(v any) []envFile {
	entries, ok := v.([]any)
	if !ok {
		entries = []any{v}
	}
	var out []envFile
	for _, e := range entries {
		switch f := e.(type) {
		case string:
			out = append(out, envFile{path: f})
		case map[string]any:
			path, _ := f["path"].(string)
			out = append(out, envFile{path: path, optional: f["required"] == false})
		}
	}
	return out
}

/*
Validate refuses what would let a stack collide with another or reach past
its own boundary, each with the service and the key.

  - container_name: Bay names every container after the stack environment; a
    fixed name collides as soon as there is a second environment
  - privileged, network_mode/pid/ipc/userns_mode host: the host itself
  - network_mode/pid/ipc/volumes_from container: any container on the host,
    another environment's included; `service:` names one of the stack's own
  - the Docker socket mounted: root on the host
  - a bind mount, or a secret's or config's file, outside the bundle or of a
    path the bundle does not carry
  - a named volume with driver_opts: they are mount(2) arguments, so
    `{type: none, o: bind, device: /etc}` is that same bind mount under
    another name, and overlay or a block device reach the host as well
  - a named volume or a network with a name of its own, or external: Bay names
    both after the stack environment, and either one reaches whatever already
    carries that name, another environment's included
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
			v, _ := svc[key].(string)
			if v == "host" {
				say("%s: host is not allowed on Bay", key)
			} else if strings.HasPrefix(v, "container:") {
				say("%s: %s is not allowed: only a service of this stack can be named", key, v)
			}
		}
		from, _ := svc["volumes_from"].([]any)
		for _, f := range from {
			if v, _ := f.(string); strings.HasPrefix(v, "container:") {
				say("volumes_from: %s is not allowed: only a service of this stack can be named", v)
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
			if p := bundleProblem(l.Dir, "bind mount", src, false); p != "" {
				say("%s", p)
			}
		}
	}
	volumes, _ := l.Model["volumes"].(map[string]any)
	for _, name := range sortedKeys(volumes) {
		vol, _ := volumes[name].(map[string]any)
		if _, ok := vol["driver_opts"]; ok {
			problems = append(problems, fmt.Sprintf(
				"volume %s: driver_opts is not allowed: they are mount options, and a bind through them reaches any host path", name))
		}
	}
	networks, _ := l.Model["networks"].(map[string]any)
	problems = append(problems, l.foreignNames("volume", volumes, "data")...)
	problems = append(problems, l.foreignNames("network", networks, "services")...)
	for _, kind := range []string{"secret", "config"} {
		section, _ := l.Model[kind+"s"].(map[string]any)
		for _, name := range sortedKeys(section) {
			entry, _ := section[name].(map[string]any)
			src, _ := entry["file"].(string)
			if src == "" {
				continue
			}
			if p := bundleProblem(l.Dir, "file", src, false); p != "" {
				problems = append(problems, fmt.Sprintf("%s %s: %s", kind, name, p))
			}
		}
	}
	if len(problems) > 0 {
		return fmt.Errorf("the compose file cannot run on Bay:\n  %s", strings.Join(problems, "\n  "))
	}
	return nil
}

/*
bundleProblem words why a path cannot be used, or answers "" when it can: it
must lie inside the bundle and, unless optional, exist there. A relative path is
the bundle's. One starting with `~` is the home directory's, which filepath.Rel
cannot place, so it reads as outside.
*/
func bundleProblem(dir, what, src string, optional bool) string {
	path := src
	if !filepath.IsAbs(path) && !strings.HasPrefix(path, "~") {
		path = filepath.Join(dir, path)
	}
	rel, err := filepath.Rel(dir, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, "../") || filepath.IsAbs(rel) {
		return fmt.Sprintf("%s %s is outside the bundle: only files the bundle carries can be used", what, src)
	}
	if _, err := os.Stat(path); err != nil && !optional {
		return fmt.Sprintf("%s ./%s is not in the bundle: add it next to the compose file", what, rel)
	}
	return ""
}

/*
foreignNames refuses each top-level volume or network that is not the stack
environment's own.

Compose writes `name` on every one, "<project>_<key>" unless the file chose
another, so the key being there says nothing: only its value does.
*/
func (l *Loaded) foreignNames(kind string, section map[string]any, reach string) []string {
	var out []string
	for _, name := range sortedKeys(section) {
		entry, _ := section[name].(map[string]any)
		key := ""
		if external, _ := entry["external"].(bool); external {
			key = "external"
		} else if fixed, _ := entry["name"].(string); fixed != "" && fixed != l.Project+"_"+name {
			key = "name"
		}
		if key != "" {
			out = append(out, fmt.Sprintf("%s %s: %s is not allowed: Bay names %ss after the stack environment, so staging never reaches production's %s",
				kind, name, key, kind, reach))
		}
	}
	return out
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
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

/*
SetImages applies the digests a revision recorded, for a rollback: exactly
what ran, never what a tag means today. A Compose service the record does not
name is refused rather than resolved afresh.
*/
func (l *Loaded) SetImages(pinned map[string]string) error {
	services, _ := l.Model["services"].(map[string]any)
	for _, name := range l.Services {
		if _, isApp := l.XLore[name]["app"]; isApp {
			continue
		}
		ref, ok := pinned[name]
		if !ok {
			return fmt.Errorf("no digest was recorded for service %s", name)
		}
		svc, _ := services[name].(map[string]any)
		svc["image"] = ref
	}
	return nil
}
