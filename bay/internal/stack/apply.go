package stack

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// appServiceProfile parks app services in the override: a profile nobody
// activates, so Compose never starts what Bay runs itself.
const appServiceProfile = "bay-app-service"

/*
Plan is what Bay will apply on top of the user's compose file, as an override
file rather than a rewritten copy: the user's file is applied as written, and
Bay's changes are listed in one place a reader can diff.
*/
type Plan struct {
	// ContainerNames gives every Compose service its Bay name, so the runner,
	// `bay status` and the connector find it by the same rule as an app.
	ContainerNames map[string]string
	// Images pins each Compose service to the digest resolved at deploy.
	Images map[string]string
	// Ports are the loopback publications that replace the file's own.
	Ports map[string][]PublishedPort
	// Apps are the app services Bay runs itself.
	Apps []string
}

/*
Override renders the plan as a compose override file.

`ports: !override` replaces the file's publications instead of merging with
them, which is what keeps `"3000:3000"` from also binding every interface.
Quoted as JSON strings, which YAML reads as the same scalars, so no value can
break the file.
*/
func (p Plan) Override() []byte {
	names := map[string]bool{}
	for n := range p.ContainerNames {
		names[n] = true
	}
	for _, n := range p.Apps {
		names[n] = true
	}
	sorted := make([]string, 0, len(names))
	for n := range names {
		sorted = append(sorted, n)
	}
	sort.Strings(sorted)

	var b strings.Builder
	b.WriteString("# Written by Bay: its changes on top of the stack's own compose file.\nservices:\n")
	isApp := map[string]bool{}
	for _, a := range p.Apps {
		isApp[a] = true
	}
	for _, name := range sorted {
		fmt.Fprintf(&b, "  %s:\n", strconv.Quote(name))
		if isApp[name] {
			fmt.Fprintf(&b, "    profiles: [%s]\n", strconv.Quote(appServiceProfile))
			continue
		}
		fmt.Fprintf(&b, "    container_name: %s\n", strconv.Quote(p.ContainerNames[name]))
		if img := p.Images[name]; img != "" {
			fmt.Fprintf(&b, "    image: %s\n", strconv.Quote(img))
		}
		b.WriteString("    ports: !override\n")
		if len(p.Ports[name]) == 0 {
			b.WriteString("      []\n")
		}
		for _, port := range p.Ports[name] {
			fmt.Fprintf(&b, "      - %s\n", strconv.Quote(fmt.Sprintf("127.0.0.1:%d:%d", port.HostPort, port.Target)))
		}
	}
	return []byte(b.String())
}

// Files written into a revision directory for Compose to apply.
const (
	preparedFile = ".bay-compose.yml"
	overrideFile = ".bay-override.yml"
)

/*
Up applies a loaded revision with Bay's override: services Compose runs are
created or recreated as their definition changed, started in dependency order,
and waited for until healthy (`--wait`). Containers of services the revision no
longer has are removed (`--remove-orphans`); Bay's own app containers carry no
Compose label and are never touched.

Interpolated once more from the same variables, so the file means exactly
what Load validated.
*/
func Up(l *Loaded, p Plan, timeout time.Duration) error {
	if len(p.ContainerNames) == 0 {
		return nil
	}
	if err := os.WriteFile(filepath.Join(l.Dir, preparedFile), l.Prepared, 0o600); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(l.Dir, overrideFile), p.Override(), 0o600); err != nil {
		return err
	}
	return compose(l.Dir, l.Project, l.Vars, timeout+30*time.Second,
		"--file", preparedFile, "--file", overrideFile,
		"up", "--detach", "--remove-orphans", "--wait", "--wait-timeout", strconv.Itoa(int(timeout.Seconds())))
}

// Down removes a stack environment's Compose containers and network, and its
// volumes too when purge is set.
func Down(dir, project string, purge bool) error {
	args := []string{"down", "--remove-orphans"}
	if purge {
		args = append(args, "--volumes")
	}
	return compose(dir, project, nil, 5*time.Minute, args...)
}

// Stop and Start act on a stack environment's Compose services in place.
func Stop(dir, project string) error  { return compose(dir, project, nil, 5*time.Minute, "stop") }
func Start(dir, project string) error { return compose(dir, project, nil, 5*time.Minute, "start") }

func compose(dir, project string, vars map[string]string, timeout time.Duration, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	full := append([]string{"compose", "--project-name", project, "--project-directory", dir}, args...)
	cmd := exec.CommandContext(ctx, ComposeCommand, full...)
	cmd.Dir = dir
	cmd.Env = append(minimalEnv(), varsEnv(vars)...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("docker compose %s: %w\n%s", args[0], err, strings.TrimSpace(lastLines(out.String(), 20)))
	}
	return nil
}

func lastLines(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}
