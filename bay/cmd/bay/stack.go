package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/alepha-dev/bay/internal/deploy"
	"github.com/alepha-dev/bay/internal/stack"
	"github.com/alepha-dev/bay/internal/state"
)

/*
stackNamePattern bounds stack and environment names to what a Compose project,
a directory and a hostname label all accept.
*/
var stackNamePattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$`)

// stackKeyOf splits "stack/env" and checks both halves.
func stackKeyOf(raw string) (string, string, error) {
	name, env, ok := strings.Cut(raw, "/")
	if !ok || !stackNamePattern.MatchString(name) || !stackNamePattern.MatchString(env) || strings.Contains(env, "/") {
		return "", "", fmt.Errorf("%q is not a stack environment: give <stack>/<env>, lowercase letters, digits and hyphens", raw)
	}
	return name, env, nil
}

func (s *server) registerStackRoutes(mux *http.ServeMux) {
	mux.HandleFunc("PUT /stacks/{stack}/{env}/vars", s.handleStackVarsSet)
	mux.HandleFunc("DELETE /stacks/{stack}/{env}/vars", s.handleStackVarsUnset)
	mux.HandleFunc("GET /stacks/{stack}/{env}/vars", s.handleStackVarsList)
	mux.HandleFunc("POST /stacks/{stack}/{env}/deploy", s.handleStackDeploy)
	mux.HandleFunc("PUT /stacks/{stack}/{env}/routes", s.handleStackRouteAdd)
	mux.HandleFunc("DELETE /stacks/{stack}/{env}/routes", s.handleStackRouteRemove)
	mux.HandleFunc("GET /stacks/{stack}/{env}/routes", s.handleStackRouteList)
	mux.HandleFunc("PUT /stacks/{stack}/{env}/registries", s.handleRegistryAdd)
	mux.HandleFunc("DELETE /stacks/{stack}/{env}/registries", s.handleRegistryRemove)
	mux.HandleFunc("GET /stacks/{stack}/{env}/registries", s.handleRegistryList)
	mux.HandleFunc("PUT /config/registry-mirror", s.handleRegistryMirror)
	mux.HandleFunc("POST /stacks/{stack}/{env}/stop", s.handleStackStop)
	mux.HandleFunc("POST /stacks/{stack}/{env}/start", s.handleStackStart)
	mux.HandleFunc("DELETE /stacks/{stack}/{env}", s.handleStackDestroy)
}

/*
handleRegistryAdd stores a registry credential for one stack environment. It
arrives with a deploy from Lore, or by hand over SSH, and is written to that
environment's own Docker config and nowhere else.
*/
func (s *server) handleRegistryAdd(w http.ResponseWriter, r *http.Request) {
	name, env, ok := s.stackPath(w, r)
	if !ok {
		return
	}
	var body struct {
		Host     string `json:"host"`
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, `body must be {"host", "username", "password"}`)
		return
	}
	if err := stack.SetCredential(s.root, name, env, body.Host, body.Username, body.Password); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"registry": strings.ToLower(body.Host)})
}

func (s *server) handleRegistryRemove(w http.ResponseWriter, r *http.Request) {
	name, env, ok := s.stackPath(w, r)
	if !ok {
		return
	}
	removed, err := stack.RemoveCredential(s.root, name, env, r.URL.Query().Get("host"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !removed {
		writeError(w, http.StatusNotFound, "no credential for that registry")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"removed": r.URL.Query().Get("host")})
}

func (s *server) handleRegistryList(w http.ResponseWriter, r *http.Request) {
	name, env, ok := s.stackPath(w, r)
	if !ok {
		return
	}
	hosts, err := stack.RegistryHosts(s.root, name, env)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"registries": hosts})
}

func (s *server) handleRegistryMirror(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Mirror string `json:"mirror"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, `body must be {"mirror": "host"}`)
		return
	}
	mirror := strings.TrimSuffix(strings.TrimPrefix(strings.TrimPrefix(body.Mirror, "https://"), "http://"), "/")
	if strings.ContainsAny(mirror, " /") && !strings.Contains(mirror, ".") {
		writeError(w, http.StatusBadRequest, "a mirror is a registry host, e.g. mirror.acme.io")
		return
	}
	if err := s.store.SetRegistryMirror(mirror); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mirror": mirror})
}

var domainPattern = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)

/*
handleStackRouteAdd sends a full domain to a service of a stack environment,
and reapplies the current revision so it serves at once. This is how an
unmodified compose file is routed, and how staging and production get
different domains.
*/
func (s *server) handleStackRouteAdd(w http.ResponseWriter, r *http.Request) {
	name, env, ok := s.stackPath(w, r)
	if !ok {
		return
	}
	var body struct {
		Service string `json:"service"`
		Domain  string `json:"domain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Service == "" {
		writeError(w, http.StatusBadRequest, `body must be {"service": "...", "domain": "..."}`)
		return
	}
	domain := strings.ToLower(strings.TrimSpace(body.Domain))
	if !domainPattern.MatchString(domain) {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("%q is not a domain (a wildcard is refused: Bay cannot prove one over ACME)", body.Domain))
		return
	}
	if owner, claimed := s.store.ClaimedBy(domain); claimed && owner != memberKey(name, env, body.Service) {
		writeError(w, http.StatusConflict, "domain "+domain+" is already served by "+owner)
		return
	}
	for _, st := range s.store.Stacks() {
		for _, e := range st.Envs {
			if st.Name == name && e.Env == env {
				continue
			}
			for _, route := range e.Routes {
				if route.Domain == domain {
					writeError(w, http.StatusConflict, "domain "+domain+" is already routed by "+st.Name+"/"+e.Env)
					return
				}
			}
		}
	}
	err := s.store.MutateStackEnv(name, env, func(e *state.StackEnv) error {
		for _, existing := range e.Routes {
			if existing.Domain == domain {
				return fmt.Errorf("%s already routes %s to %s", name+"/"+env, domain, existing.Service)
			}
		}
		e.Routes = append(e.Routes, state.StackRoute{Service: body.Service, Domain: domain})
		return nil
	})
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	s.respondAfterRouteChange(w, r, name, env)
}

func (s *server) handleStackRouteRemove(w http.ResponseWriter, r *http.Request) {
	name, env, ok := s.stackPath(w, r)
	if !ok {
		return
	}
	domain := strings.ToLower(r.URL.Query().Get("domain"))
	found := false
	err := s.store.MutateStackEnv(name, env, func(e *state.StackEnv) error {
		kept := e.Routes[:0]
		for _, route := range e.Routes {
			if route.Domain == domain {
				found = true
				continue
			}
			kept = append(kept, route)
		}
		e.Routes = kept
		return nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !found {
		writeError(w, http.StatusNotFound, name+"/"+env+" has no route for "+domain)
		return
	}
	s.respondAfterRouteChange(w, r, name, env)
}

// respondAfterRouteChange reapplies the current revision when there is one,
// so the routes the record names are the ones served.
func (s *server) respondAfterRouteChange(w http.ResponseWriter, r *http.Request, name, env string) {
	se, _ := s.store.StackEnv(name, env)
	if se.Revision == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"routes": se.Routes, "note": "applied at the first `bay stack deploy`"})
		return
	}
	if _, err := s.deployStack(r.Context(), stackDeployOptions{Stack: name, Env: env}); err != nil {
		writeError(w, http.StatusBadRequest, "recorded, but reapplying the stack failed: "+err.Error())
		return
	}
	se, _ = s.store.StackEnv(name, env)
	writeJSON(w, http.StatusOK, map[string]any{"routes": se.Routes})
}

func (s *server) handleStackRouteList(w http.ResponseWriter, r *http.Request) {
	name, env, ok := s.stackPath(w, r)
	if !ok {
		return
	}
	se, _ := s.store.StackEnv(name, env)
	writeJSON(w, http.StatusOK, map[string]any{"baseDomain": se.BaseDomain, "routes": se.Routes})
}

/*
handleStackDeploy applies a revision: the request body is a bundle archive
for a new revision, or empty to reapply the current one (`revision=N` rolls
back to an earlier one). `dryRun=1` answers the plan and changes nothing.
*/
func (s *server) handleStackDeploy(w http.ResponseWriter, r *http.Request) {
	name, env, ok := s.stackPath(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	opts := stackDeployOptions{Stack: name, Env: env, DryRun: q.Get("dryRun") == "1"}
	if raw := q.Get("revision"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			writeError(w, http.StatusBadRequest, "revision must be a revision number")
			return
		}
		opts.Revision = n
	}
	tmp, err := os.CreateTemp("", "bay-stack-*.tar")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer os.Remove(tmp.Name())
	size, err := io.Copy(tmp, io.LimitReader(r.Body, stack.MaxBundleBytes+1))
	tmp.Close()
	if err != nil {
		writeError(w, http.StatusBadRequest, "read bundle: "+err.Error())
		return
	}
	if size > stack.MaxBundleBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "the bundle is over the bundle size limit")
		return
	}
	if size > 0 {
		if opts.Revision > 0 {
			writeError(w, http.StatusBadRequest, "give a bundle or a revision to roll back to, not both")
			return
		}
		opts.Bundle = tmp.Name()
	}
	out, err := s.deployStack(r.Context(), opts)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) stackPath(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	name, env, err := stackKeyOf(r.PathValue("stack") + "/" + r.PathValue("env"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return "", "", false
	}
	return name, env, true
}

/*
handleStackVarsSet merges KEY=VALUE lines into a stack environment's
variables. Recorded, not applied: they reach the services at the next
`bay stack deploy`, which is also where a variable the file needs and lacks is
refused.
*/
func (s *server) handleStackVarsSet(w http.ResponseWriter, r *http.Request) {
	name, env, ok := s.stackPath(w, r)
	if !ok {
		return
	}
	updates, err := deploy.ParseAssignments(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	changed, err := stack.SetVars(s.root, name, env, updates)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"changed": changed,
		"note": "takes effect at the next `bay stack deploy " + name + "/" + env + "`"})
}

func (s *server) handleStackVarsUnset(w http.ResponseWriter, r *http.Request) {
	name, env, ok := s.stackPath(w, r)
	if !ok {
		return
	}
	removed, err := stack.UnsetVars(s.root, name, env, r.URL.Query()["key"])
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"removed": removed})
}

func (s *server) handleStackVarsList(w http.ResponseWriter, r *http.Request) {
	name, env, ok := s.stackPath(w, r)
	if !ok {
		return
	}
	names, err := stack.VarNames(s.root, name, env)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"names": names})
}

const stackUsage = `usage: bay stack <command> <stack>/<env> ...
  env set <stack>/<env> (-|FILE)     merge KEY=VALUE lines, read from stdin or a file
  env list <stack>/<env>             variable names, never values
  env unset <stack>/<env> KEY...     remove variables
  route <stack>/<env> <service> <domain>   serve a full domain from a service
  route list <stack>/<env>           the environment's routes
  route remove <stack>/<env> <domain>
  registry add <stack>/<env> HOST --username U   password read from stdin
  registry list <stack>/<env>        hosts only
  registry remove <stack>/<env> HOST
  stop <stack>/<env>                 out of service, durably: services and apps
  start <stack>/<env>                back, from the current revision
  destroy <stack>/<env> [--purge [--yes]]   remove containers; --purge deletes volumes`

// cmdStack is `bay stack`.
func cmdStack(args []string) error {
	if len(args) < 1 {
		return errors.New(stackUsage)
	}
	switch args[0] {
	case "env":
		return cmdStackEnv(args[1:])
	case "route":
		return cmdStackRoute(args[1:])
	case "registry":
		return cmdStackRegistry(args[1:])
	case "stop", "start", "destroy":
		return cmdStackLifecycle(args[0], args[1:])
	default:
		return errors.New(stackUsage)
	}
}

func cmdStackEnv(args []string) error {
	if len(args) < 2 {
		return errors.New(stackUsage)
	}
	name, env, err := stackKeyOf(args[1])
	if err != nil {
		return err
	}
	base := controlHost + "/stacks/" + name + "/" + env + "/vars"
	switch args[0] {
	case "set":
		if len(args) < 3 {
			return errors.New(stackUsage)
		}
		if strings.Contains(args[2], "=") {
			return errors.New("values are read from stdin, never from the command line: an argument is visible in `ps` to every user on this machine.\n" + stackUsage)
		}
		body, closeBody, err := artifactBody(args[2], os.Stdin)
		if err != nil {
			return err
		}
		defer closeBody()
		res, err := call(http.MethodPut, base, body)
		if err != nil {
			return err
		}
		fmt.Println(res)
	case "list":
		res, err := call(http.MethodGet, base, nil)
		if err != nil {
			return err
		}
		var out struct {
			Names []string `json:"names"`
		}
		if json.Unmarshal([]byte(res), &out) == nil {
			for _, n := range out.Names {
				fmt.Println(n)
			}
			return nil
		}
		fmt.Println(res)
	case "unset":
		if len(args) < 3 {
			return errors.New(stackUsage)
		}
		query := ""
		for i, k := range args[2:] {
			if i == 0 {
				query += "?"
			} else {
				query += "&"
			}
			query += "key=" + k
		}
		res, err := call(http.MethodDelete, base+query, nil)
		if err != nil {
			return err
		}
		fmt.Println(res)
	default:
		return errors.New(stackUsage)
	}
	return nil
}

func cmdStackRoute(args []string) error {
	if len(args) < 2 {
		return errors.New(stackUsage)
	}
	switch args[0] {
	case "list":
		name, env, err := stackKeyOf(args[1])
		if err != nil {
			return err
		}
		res, err := call(http.MethodGet, controlHost+"/stacks/"+name+"/"+env+"/routes", nil)
		if err != nil {
			return err
		}
		fmt.Println(res)
		return nil
	case "remove":
		if len(args) < 3 {
			return errors.New(stackUsage)
		}
		name, env, err := stackKeyOf(args[1])
		if err != nil {
			return err
		}
		res, err := call(http.MethodDelete, controlHost+"/stacks/"+name+"/"+env+"/routes?domain="+args[2], nil)
		if err != nil {
			return err
		}
		fmt.Println(res)
		return nil
	}
	if len(args) < 3 {
		return errors.New(stackUsage)
	}
	name, env, err := stackKeyOf(args[0])
	if err != nil {
		return err
	}
	body, _ := json.Marshal(map[string]string{"service": args[1], "domain": args[2]})
	res, err := call(http.MethodPut, controlHost+"/stacks/"+name+"/"+env+"/routes", strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

func cmdStackRegistry(args []string) error {
	if len(args) < 2 {
		return errors.New(stackUsage)
	}
	name, env, err := stackKeyOf(args[1])
	if err != nil {
		return err
	}
	base := controlHost + "/stacks/" + name + "/" + env + "/registries"
	switch args[0] {
	case "add":
		if len(args) < 5 || args[3] != "--username" {
			return errors.New(stackUsage)
		}
		// The password comes from stdin only: an argument is visible in ps.
		raw, err := io.ReadAll(io.LimitReader(os.Stdin, 64<<10))
		if err != nil {
			return err
		}
		body, _ := json.Marshal(map[string]string{"host": args[2], "username": args[4],
			"password": strings.TrimRight(string(raw), "\r\n")})
		res, err := call(http.MethodPut, base, strings.NewReader(string(body)))
		if err != nil {
			return err
		}
		fmt.Println(res)
	case "list":
		res, err := call(http.MethodGet, base, nil)
		if err != nil {
			return err
		}
		fmt.Println(res)
	case "remove":
		if len(args) < 3 {
			return errors.New(stackUsage)
		}
		res, err := call(http.MethodDelete, base+"?host="+args[2], nil)
		if err != nil {
			return err
		}
		fmt.Println(res)
	default:
		return errors.New(stackUsage)
	}
	return nil
}

// cmdConfigMirror is `bay config registry-mirror (HOST|--clear)`.
func cmdConfigMirror(args []string) error {
	if len(args) < 1 {
		return errors.New("usage: bay config registry-mirror (HOST|--clear)")
	}
	mirror := args[0]
	if mirror == "--clear" {
		mirror = ""
	}
	body, _ := json.Marshal(map[string]string{"mirror": mirror})
	res, err := call(http.MethodPut, controlHost+"/config/registry-mirror", strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}
