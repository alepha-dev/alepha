package stack

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

/*
XLore is a service's `x-lore` field, the part of a compose file only Bay
reads. Named for Lore, never for Bay, because the same field means the same
thing on every target a stack may run on.
*/
type XLore struct {
	// App marks the service as an app: Bay runs it itself (blue/green,
	// hardening) from the artifact deployed under this name, an archive in its
	// runtime image or an image. Empty for a service Compose runs.
	App string
	// Routes are labels relative to the environment's base domain: "@" is the
	// base domain, "auth" is auth.<base>. Full domains are never written in
	// the file: production and staging need different ones.
	Routes []string
	// Port is the container port routes reach, when the service publishes
	// several or none. Defaults to the first published port.
	Port int
	// Runtime overrides an app service's runtime image.
	Runtime string
	// TCP opens a raw TCP listener for this container port (MQTT over TLS).
	TCP int
	// Backup declares how to dump the service; run by stack backups.
	Backup *Backup
}

// Backup is `x-lore.backup`: one of its two forms.
type Backup struct {
	Postgres *PostgresBackup
	Command  string
}

// PostgresBackup dumps with pg_dump inside the service's container.
type PostgresBackup struct {
	User string
	DB   string
}

var routeLabel = regexp.MustCompile(`^(@|[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)$`)

/*
parseXLore reads one service's raw `x-lore`, refusing unknown keys and
malformed values, so a typo is never silently ignored.
*/
func parseXLore(service string, raw map[string]any) (XLore, error) {
	var x XLore
	fail := func(format string, args ...any) (XLore, error) {
		return XLore{}, fmt.Errorf("service %s: x-lore.%s", service, fmt.Sprintf(format, args...))
	}
	keys := make([]string, 0, len(raw))
	for k := range raw {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, key := range keys {
		value := raw[key]
		switch key {
		case "app":
			s, ok := value.(string)
			if !ok || s == "" {
				return fail("app must name the app deployed into this service")
			}
			x.App = s
		case "routes":
			list, ok := value.([]any)
			if !ok {
				return fail("routes must be a list of labels, e.g. [\"@\", \"auth\"]")
			}
			for _, item := range list {
				label, _ := item.(string)
				if strings.Contains(label, ".") {
					return fail("routes: %q is a full domain; the file only names labels (\"@\", \"auth\"), full domains are set per environment with `bay stack route`", label)
				}
				if !routeLabel.MatchString(label) {
					return fail("routes: %q is not a label: \"@\" or lowercase letters, digits and hyphens", label)
				}
				x.Routes = append(x.Routes, label)
			}
		case "port", "tcp":
			n, ok := value.(int)
			if !ok || n < 1 || n > 65535 {
				return fail("%s must be a port number", key)
			}
			if key == "port" {
				x.Port = n
			} else {
				x.TCP = n
			}
		case "runtime":
			s, ok := value.(string)
			if !ok || s == "" || strings.ContainsAny(s, " \t") {
				return fail("runtime must be an image reference")
			}
			x.Runtime = s
		case "backup":
			b, err := parseBackup(value)
			if err != nil {
				return fail("backup: %v", err)
			}
			x.Backup = b
		default:
			return fail("%s is not a field Bay knows (app, routes, port, runtime, tcp, backup)", key)
		}
	}
	if x.Runtime != "" && x.App == "" {
		return fail("runtime only applies to an app service (x-lore.app)")
	}
	return x, nil
}

func parseBackup(value any) (*Backup, error) {
	m, ok := value.(map[string]any)
	if !ok || len(m) != 1 {
		return nil, fmt.Errorf(`give exactly one of {postgres: {user, db}} or {command: "..."}`)
	}
	if pg, ok := m["postgres"].(map[string]any); ok {
		user, _ := pg["user"].(string)
		db, _ := pg["db"].(string)
		if user == "" || db == "" {
			return nil, fmt.Errorf("postgres needs user and db")
		}
		return &Backup{Postgres: &PostgresBackup{User: user, DB: db}}, nil
	}
	if cmd, ok := m["command"].(string); ok && cmd != "" {
		return &Backup{Command: cmd}, nil
	}
	return nil, fmt.Errorf(`give exactly one of {postgres: {user, db}} or {command: "..."}`)
}

/*
Lore parses every service's `x-lore`, and refuses a plain service that
depends on an app service: on Bay, services start first and apps after their
healthchecks pass, so that dependency could never be met.
*/
func (l *Loaded) Lore() (map[string]XLore, error) {
	out := map[string]XLore{}
	for _, name := range l.Services {
		x, err := parseXLore(name, l.XLore[name])
		if err != nil {
			return nil, err
		}
		out[name] = x
	}
	services, _ := l.Model["services"].(map[string]any)
	for _, name := range l.Services {
		if out[name].App != "" {
			continue
		}
		svc, _ := services[name].(map[string]any)
		deps, _ := svc["depends_on"].(map[string]any)
		for dep := range deps {
			if out[dep].App != "" {
				return nil, fmt.Errorf("service %s depends on %s, an app service: on Bay services start first and apps after them, so drop that depends_on", name, dep)
			}
		}
	}
	return out, nil
}

/*
ResolveRoute turns a route label into a domain under the environment's base
domain: "@" is the base itself.
*/
func ResolveRoute(label, base string) string {
	if label == "@" {
		return base
	}
	return label + "." + base
}
