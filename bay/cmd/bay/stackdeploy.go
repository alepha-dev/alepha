package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/alepha-dev/bay/internal/deploy"
	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/proxy"
	"github.com/alepha-dev/bay/internal/runner"
	"github.com/alepha-dev/bay/internal/stack"
	"github.com/alepha-dev/bay/internal/state"
)

// stackUpTimeout bounds how long a stack deploy waits for its services to
// become healthy.
const stackUpTimeout = 5 * time.Minute

// stackDeployOptions is one apply of a revision to a stack environment.
type stackDeployOptions struct {
	Stack, Env string
	// Bundle is a bundle archive to store as a new revision. Empty reapplies
	// Revision, or the current revision when Revision is 0.
	Bundle string
	// Revision names an earlier revision to roll back to, with the digests
	// it recorded.
	Revision int
	// DryRun answers the plan and changes nothing.
	DryRun bool
}

// stackDeployOutcome is what a stack deploy reports.
type stackDeployOutcome struct {
	Stack    string         `json:"stack"`
	Env      string         `json:"env"`
	Revision int            `json:"revision"`
	DryRun   bool           `json:"dryRun,omitempty"`
	Plan     stackPlan      `json:"plan"`
	Members  []stackMember  `json:"members"`
	Pending  []string       `json:"pending,omitempty"`
	Warnings []string       `json:"warnings,omitempty"`
	Digests  map[string]any `json:"digests,omitempty"`
}

// stackPlan is what a revision changes, by service.
type stackPlan struct {
	Created []string `json:"created"`
	Changed []string `json:"changed"`
	Removed []string `json:"removed"`
	// Fields names, for each changed service, the keys that differ.
	Fields map[string][]string `json:"fields,omitempty"`
}

// stackMember is one service as the deploy left it.
type stackMember struct {
	Service string   `json:"service"`
	Kind    string   `json:"kind"`
	Domains []string `json:"domains,omitempty"`
	Port    int      `json:"port,omitempty"`
}

// digestResolver is the runner's ability to pin a tag: the Docker runner.
type digestResolver interface {
	ResolveDigestAuth(tag, auth string) (string, error)
}

// networkCreator is the runner's ability to create a stack's network.
type networkCreator interface {
	EnsureNetwork(name, project string) error
}

var stackLocks sync.Map

// lockStack serialises deploys of one stack environment.
func lockStack(name, env string) func() {
	m, _ := stackLocks.LoadOrStore(name+"/"+env, &sync.Mutex{})
	mu := m.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

func memberKey(name, env, service string) string {
	return state.MemberName(name, service) + "/" + env
}

/*
deployStack applies a revision to a stack environment.

The user's compose file is applied as written, with Bay's override on top
(container names, pinned images, loopback ports, app services parked), and
`docker compose up --wait` starts services in dependency order and waits for
their healthchecks before any app starts, so an app's migrations never race its
database. Only what changed is recreated. App services are Bay's: run blue/green
on the stack's network under their service name. Every service that runs is
recorded as an App member, so the proxy, the status and the connector see it.
*/
func (s *server) deployStack(ctx context.Context, opts stackDeployOptions) (*stackDeployOutcome, error) {
	if _, _, err := stackKeyOf(opts.Stack + "/" + opts.Env); err != nil {
		return nil, err
	}
	defer lockStack(opts.Stack, opts.Env)()

	env, _ := s.store.StackEnv(opts.Stack, opts.Env)
	n, pinned, cleanup, err := s.stackRevision(env, opts)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	dir := stack.RevisionDir(s.root, opts.Stack, opts.Env, n)
	if opts.DryRun && opts.Bundle != "" {
		dir = filepath.Join(filepath.Dir(dir), ".dry-run")
	}
	project := naming.StackProject(opts.Stack, opts.Env)

	vars, err := stack.LoadVars(s.root, opts.Stack, opts.Env)
	if err != nil {
		return nil, err
	}
	loaded, err := stack.Load(dir, project, vars)
	if err != nil {
		return nil, err
	}
	if err := loaded.Validate(); err != nil {
		return nil, err
	}
	lore, err := loaded.Lore()
	if err != nil {
		return nil, err
	}

	base := env.BaseDomain
	if base == "" && s.store.BaseDomain() != "" {
		base = stackSubdomain(opts.Stack, opts.Env) + "." + s.store.BaseDomain()
	}
	domains, err := s.stackDomains(opts.Stack, opts.Env, env, lore, base)
	if err != nil {
		return nil, err
	}
	targets, err := routeTargets(loaded, lore, domains)
	if err != nil {
		return nil, err
	}

	hostPorts := env.HostPorts
	if hostPorts == nil {
		hostPorts = map[string]int{}
	}
	used := s.allClaimedPorts()
	published, err := loaded.RewritePorts(func(service string, target int) (int, error) {
		key := service + ":" + strconv.Itoa(target)
		if p, ok := hostPorts[key]; ok {
			return p, nil
		}
		p, err := deploy.AllocatePort(used)
		if err != nil {
			return 0, err
		}
		used[p] = true
		hostPorts[key] = p
		return p, nil
	})
	if err != nil {
		return nil, err
	}

	// Snapshotted before images are pinned: a plan compares what the files
	// say, so an unchanged tag is unchanged even when it now resolves anew.
	snapshot := comparableServices(loaded, lore)
	plan := s.diffRevision(opts.Stack, env, snapshot)
	tcp, err := s.stackTCP(opts.Stack, opts.Env, lore, hostPorts)
	if err != nil {
		return nil, err
	}
	outcome := &stackDeployOutcome{Stack: opts.Stack, Env: opts.Env, Revision: n, DryRun: opts.DryRun, Plan: plan,
		Warnings: healthWarnings(loaded, lore)}
	if opts.DryRun {
		for _, name := range loaded.Services {
			outcome.Members = append(outcome.Members, stackMember{Service: name, Kind: kindOf(lore[name]), Domains: domains[name]})
		}
		return outcome, nil
	}

	if pinned == nil {
		resolver, ok := s.runner.(digestResolver)
		if !ok {
			return nil, fmt.Errorf("stacks need Bay's Docker runner")
		}
		mirror := s.store.RegistryMirror()
		pinned, err = loaded.PinImages(func(image string) (string, error) {
			ref := stack.Mirrored(image, mirror)
			auth, err := stack.RegistryAuthFor(s.root, opts.Stack, opts.Env, ref)
			if err != nil {
				return "", err
			}
			return resolver.ResolveDigestAuth(ref, auth)
		})
		if err != nil {
			return nil, err
		}
	} else if err := loaded.SetImages(pinned); err != nil {
		return nil, fmt.Errorf("revision %d: %w", n, err)
	}
	stackPlanOf := stack.Plan{ContainerNames: map[string]string{}, Images: pinned, Ports: published}
	for _, name := range loaded.Services {
		if lore[name].App != "" {
			stackPlanOf.Apps = append(stackPlanOf.Apps, name)
			continue
		}
		stackPlanOf.ContainerNames[name] = runner.ContainerName(memberKey(opts.Stack, opts.Env, name))
	}
	if nc, ok := s.runner.(networkCreator); ok {
		if err := nc.EnsureNetwork(project+"_default", project); err != nil {
			return nil, err
		}
	}
	if err := stack.Up(loaded, stackPlanOf, stackUpTimeout); err != nil {
		return nil, err
	}

	// Members, recorded after the services are healthy.
	previous := s.store.StackMembers(opts.Stack, opts.Env)
	current := map[string]bool{}
	for _, name := range loaded.Services {
		key := memberKey(opts.Stack, opts.Env, name)
		current[key] = true
		x := lore[name]
		member := stackMember{Service: name, Kind: kindOf(x), Domains: domains[name]}
		if x.App == "" {
			port := 0
			if t := targets[name]; t != 0 {
				port = hostPorts[name+":"+strconv.Itoa(t)]
			}
			member.Port = port
			if err := s.store.Upsert(state.App{
				Name: state.MemberName(opts.Stack, name), Env: opts.Env, Domains: domains[name],
				Release: "revision " + strconv.Itoa(n), Port: port,
				Stack: opts.Stack, Service: name, ServiceKind: "service",
			}); err != nil {
				return nil, err
			}
		} else if err := s.recordAppMember(opts.Stack, opts.Env, name, x, domains[name], outcome); err != nil {
			return nil, err
		}
		outcome.Members = append(outcome.Members, member)
	}
	for _, old := range previous {
		if current[old.Key()] {
			continue
		}
		if old.ServiceKind == "app" {
			_ = s.runner.Stop(old.Key(), stopGrace)
			_ = s.runner.Remove(old.Key(), true)
		}
		_, _, _ = s.store.Remove(old.Key())
	}

	digests := map[string]any{}
	for k, v := range pinned {
		digests[k] = v
	}
	outcome.Digests = digests
	err = s.store.MutateStackEnv(opts.Stack, opts.Env, func(e *state.StackEnv) error {
		e.Revision = n
		e.HostPorts = hostPorts
		e.TCP = tcp
		if e.BaseDomain == "" {
			e.BaseDomain = base
		}
		for i := range e.Revisions {
			if e.Revisions[i].Number == n {
				e.Revisions[i].AppliedAt = time.Now().UTC().Format(time.RFC3339)
				return nil
			}
		}
		e.Revisions = append(e.Revisions, state.StackRevision{Number: n, Digests: pinned,
			AppliedAt: time.Now().UTC().Format(time.RFC3339)})
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.saveModel(dir, snapshot)
	s.syncTCP()
	if s.tls != nil {
		var all []string
		for _, d := range domains {
			all = append(all, d...)
		}
		if len(all) > 0 {
			if err := s.tls.Manage(ctx, all); err != nil {
				s.log.Error("certificate for a stack domain failed", "stack", opts.Stack+"/"+opts.Env, "err", err)
			}
		}
	}
	return outcome, nil
}

/*
stackRevision decides which revision this deploy applies: a new one from a
bundle, an earlier one for a rollback (with the digests it recorded), or the
current one again.
*/
func (s *server) stackRevision(env state.StackEnv, opts stackDeployOptions) (int, map[string]string, func(), error) {
	noop := func() {}
	if opts.Bundle != "" {
		n := 1
		for _, r := range env.Revisions {
			if r.Number >= n {
				n = r.Number + 1
			}
		}
		if opts.DryRun {
			dir := filepath.Join(stack.Dir(s.root, opts.Stack, opts.Env), "revisions", ".dry-run")
			_ = os.RemoveAll(dir)
			stored, err := stack.StoreBundle(opts.Bundle, s.root, opts.Stack, opts.Env, -1)
			if err != nil {
				return 0, nil, noop, err
			}
			if err := os.Rename(stored, dir); err != nil {
				return 0, nil, noop, err
			}
			return n, nil, func() { os.RemoveAll(dir) }, nil
		}
		if _, err := stack.StoreBundle(opts.Bundle, s.root, opts.Stack, opts.Env, n); err != nil {
			return 0, nil, noop, err
		}
		return n, nil, noop, nil
	}
	if opts.Revision > 0 {
		for _, r := range env.Revisions {
			if r.Number == opts.Revision {
				return r.Number, r.Digests, noop, nil
			}
		}
		return 0, nil, noop, fmt.Errorf("%s/%s has no revision %d", opts.Stack, opts.Env, opts.Revision)
	}
	if env.Revision == 0 {
		return 0, nil, noop, fmt.Errorf("%s/%s has no revision yet: deploy a bundle first", opts.Stack, opts.Env)
	}
	for _, r := range env.Revisions {
		if r.Number == env.Revision {
			return r.Number, r.Digests, noop, nil
		}
	}
	return env.Revision, nil, noop, nil
}

/*
recordAppMember registers an app service and starts it when it can: blue/green
when its container is up (new routes, network or variables), a plain start when
an artifact was deployed but nothing runs, and nothing at all before its first
artifact, reported as pending.
*/
func (s *server) recordAppMember(name, env, service string, x stack.XLore, domains []string, outcome *stackDeployOutcome) error {
	key := memberKey(name, env, service)
	existing, ok := s.store.Get(key)
	if !ok {
		port, err := deploy.AllocatePort(s.allClaimedPorts())
		if err != nil {
			return err
		}
		app := state.App{Name: state.MemberName(name, service), Env: env, Domains: domains, Port: port,
			Stack: name, Service: service, ServiceKind: "app", RuntimeImage: x.Runtime}
		if err := s.store.Upsert(app); err != nil {
			return err
		}
		outcome.Pending = append(outcome.Pending, service+": waiting for its first artifact (bay deploy "+name+"/"+env+"/"+service+" -)")
		return nil
	}
	existing.Domains = domains
	existing.Stack, existing.Service, existing.ServiceKind = name, service, "app"
	if x.Runtime != "" {
		existing.RuntimeImage = x.Runtime
	}
	if err := s.store.Upsert(existing); err != nil {
		return err
	}
	if existing.Release == "" && existing.Image == "" {
		outcome.Pending = append(outcome.Pending, service+": waiting for its first artifact (bay deploy "+name+"/"+env+"/"+service+" -)")
		return nil
	}
	app, _ := s.store.Get(key)
	if app.Stopped {
		return nil
	}
	if s.runner.Running(key) {
		return s.restart(app)
	}
	return s.start(app)
}

/*
stackDomains resolves every service's routes: the labels its `x-lore` names,
under the environment's base domain, and the environment's full-domain routes.
A domain another instance already serves is refused here, before anything
moves.
*/
func (s *server) stackDomains(name, env string, se state.StackEnv, lore map[string]stack.XLore, base string) (map[string][]string, error) {
	out := map[string][]string{}
	for service, x := range lore {
		for _, label := range x.Routes {
			if base == "" {
				return nil, fmt.Errorf("service %s routes %q, but %s/%s has no base domain: start bay with --base-domain, or set one", service, label, name, env)
			}
			out[service] = append(out[service], stack.ResolveRoute(label, base))
		}
	}
	for _, r := range se.Routes {
		if _, ok := lore[r.Service]; !ok {
			return nil, fmt.Errorf("route %s names service %s, which the compose file does not have", r.Domain, r.Service)
		}
		out[r.Service] = append(out[r.Service], r.Domain)
	}
	for service, ds := range out {
		key := memberKey(name, env, service)
		for _, d := range ds {
			if owner, claimed := s.store.ClaimedBy(d); claimed && owner != key {
				return nil, fmt.Errorf("service %s: domain %s is already served by %s", service, d, owner)
			}
		}
		sort.Strings(ds)
	}
	return out, nil
}

/*
routeTargets picks the container port each routed service is reached on: its
`x-lore.port`, else its first published port. A routed service with neither is
refused; a target it does not publish yet is added to its ports, so the
override publishes it on loopback.
*/
func routeTargets(l *stack.Loaded, lore map[string]stack.XLore, domains map[string][]string) (map[string]int, error) {
	out := map[string]int{}
	services, _ := l.Model["services"].(map[string]any)
	for _, name := range l.Services {
		if lore[name].App != "" || len(domains[name]) == 0 {
			continue
		}
		svc, _ := services[name].(map[string]any)
		ports, _ := svc["ports"].([]any)
		target := lore[name].Port
		if target == 0 && len(ports) > 0 {
			if p, ok := ports[0].(map[string]any); ok {
				target = intOf(p["target"])
			}
		}
		if target == 0 {
			return nil, fmt.Errorf("service %s is routed but publishes no port: add ports, or x-lore.port", name)
		}
		found := false
		for _, p := range ports {
			if pm, ok := p.(map[string]any); ok && intOf(pm["target"]) == target {
				found = true
			}
		}
		if !found {
			svc["ports"] = append(ports, map[string]any{"target": float64(target), "protocol": "tcp"})
		}
		out[name] = target
	}
	if tcp := tcpRequests(lore); len(tcp) > 0 {
		for name, port := range tcp {
			if _, ok := out[name]; ok {
				continue
			}
			svc, _ := services[name].(map[string]any)
			ports, _ := svc["ports"].([]any)
			svc["ports"] = append(ports, map[string]any{"target": float64(port), "protocol": "tcp"})
		}
	}
	return out, nil
}

func tcpRequests(lore map[string]stack.XLore) map[string]int {
	out := map[string]int{}
	for name, x := range lore {
		if x.TCP != 0 && x.App == "" {
			out[name] = x.TCP
		}
	}
	return out
}

func intOf(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case string:
		i, _ := strconv.Atoi(n)
		return i
	}
	return 0
}

func kindOf(x stack.XLore) string {
	if x.App != "" {
		return "app"
	}
	return "service"
}

// allClaimedPorts is every host port an app or a stack holds.
func (s *server) allClaimedPorts() map[int]bool {
	used := s.store.UsedPorts()
	for _, st := range s.store.Stacks() {
		for _, e := range st.Envs {
			for _, p := range e.HostPorts {
				used[p] = true
			}
		}
	}
	return used
}

func stackSubdomain(name, env string) string {
	if env == "production" {
		return name
	}
	return name + "-" + env
}

// modelFile keeps the normalised services of the applied revision, so the
// next deploy's plan can say what changes.
const modelFile = ".bay-model.json"

func (s *server) saveModel(dir string, snapshot map[string]any) {
	raw, err := json.Marshal(snapshot)
	if err == nil {
		_ = os.WriteFile(filepath.Join(dir, modelFile), raw, 0o600)
	}
}

// comparableServices is each service's definition, without what Bay itself
// rewrites on every deploy.
func comparableServices(l *stack.Loaded, lore map[string]stack.XLore) map[string]any {
	out := map[string]any{}
	services, _ := l.Model["services"].(map[string]any)
	for name, def := range services {
		svc, _ := def.(map[string]any)
		c := map[string]any{}
		for k, v := range svc {
			if k == "ports" {
				continue
			}
			c[k] = v
		}
		c["x-lore"] = lore[name]
		out[name] = c
	}
	return out
}

// diffRevision compares the revision about to be applied with the one that is.
func (s *server) diffRevision(name string, env state.StackEnv, snapshot map[string]any) stackPlan {
	plan := stackPlan{Created: []string{}, Changed: []string{}, Removed: []string{}, Fields: map[string][]string{}}
	var before map[string]any
	if env.Revision > 0 {
		raw, err := os.ReadFile(filepath.Join(stack.RevisionDir(s.root, name, env.Env, env.Revision), modelFile))
		if err == nil {
			_ = json.Unmarshal(raw, &before)
		}
	}
	after := map[string]any{}
	raw, _ := json.Marshal(snapshot)
	_ = json.Unmarshal(raw, &after)
	for name, def := range after {
		old, ok := before[name]
		switch {
		case !ok:
			plan.Created = append(plan.Created, name)
		case !reflect.DeepEqual(old, def):
			plan.Changed = append(plan.Changed, name)
			plan.Fields[name] = changedFields(old, def)
		}
	}
	for name := range before {
		if _, ok := after[name]; !ok {
			plan.Removed = append(plan.Removed, name)
		}
	}
	sort.Strings(plan.Created)
	sort.Strings(plan.Changed)
	sort.Strings(plan.Removed)
	return plan
}

/*
stackTCP maps each `x-lore.tcp` port to the loopback port Compose published it
on. A public port is one per host: another stack environment holding it, or
another program, refuses the deploy before anything moves.
*/
func (s *server) stackTCP(name, env string, lore map[string]stack.XLore, hostPorts map[string]int) (map[int]int, error) {
	out := map[int]int{}
	for service, x := range lore {
		if x.TCP == 0 {
			continue
		}
		if x.App != "" {
			return nil, fmt.Errorf("service %s: x-lore.tcp is for services Compose runs; an app service is reached over HTTP", service)
		}
		for _, st := range s.store.Stacks() {
			for _, e := range st.Envs {
				if st.Name == name && e.Env == env {
					continue
				}
				if _, taken := e.TCP[x.TCP]; taken {
					return nil, fmt.Errorf("service %s: TCP port %d is already opened for %s/%s", service, x.TCP, st.Name, e.Env)
				}
			}
		}
		if s.tcp == nil || !s.tcp.Owns(x.TCP) {
			if err := proxy.PortFree(x.TCP); err != nil {
				return nil, fmt.Errorf("service %s: %w", service, err)
			}
		}
		out[x.TCP] = hostPorts[service+":"+strconv.Itoa(x.TCP)]
	}
	return out, nil
}

// syncTCP opens exactly the TCP ports every stack environment asks for.
func (s *server) syncTCP() {
	if s.tcp == nil {
		return
	}
	forwards := map[int]int{}
	for _, st := range s.store.Stacks() {
		for _, e := range st.Envs {
			if e.Stopped {
				continue
			}
			for public, target := range e.TCP {
				forwards[public] = target
			}
		}
	}
	for port, err := range s.tcp.Sync(forwards) {
		s.log.Error("could not open a stack's TCP port", "port", port, "err", err)
	}
}

// changedFields lists the top-level keys of a service definition that differ.
func changedFields(before, after any) []string {
	b, _ := before.(map[string]any)
	a, _ := after.(map[string]any)
	keys := map[string]bool{}
	for k := range b {
		keys[k] = true
	}
	for k := range a {
		keys[k] = true
	}
	var out []string
	for k := range keys {
		if !reflect.DeepEqual(b[k], a[k]) {
			out = append(out, k)
		}
	}
	sort.Strings(out)
	return out
}

/*
healthWarnings names the Compose services with no healthcheck: `--wait`
counts them ready once running, so an app starting after them may still meet
a database that is booting.
*/
func healthWarnings(l *stack.Loaded, lore map[string]stack.XLore) []string {
	var out []string
	services, _ := l.Model["services"].(map[string]any)
	for _, name := range l.Services {
		if lore[name].App != "" {
			continue
		}
		svc, _ := services[name].(map[string]any)
		if _, ok := svc["healthcheck"]; !ok {
			out = append(out, "service "+name+" has no healthcheck: Bay counts it ready once it runs, which is not the same as serving")
		}
	}
	return out
}
