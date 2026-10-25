package main

import (
	"archive/tar"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	neturl "net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/runner"
	"github.com/alepha-dev/bay/internal/stack"
	"github.com/alepha-dev/bay/internal/state"
)

// stackView is one stack environment as `bay stack list` and `ps` show it.
type stackView struct {
	Stack     string         `json:"stack"`
	Env       string         `json:"env"`
	Revision  int            `json:"revision"`
	Revisions []int          `json:"revisions"`
	Stopped   bool           `json:"stopped,omitempty"`
	Domain    string         `json:"baseDomain,omitempty"`
	Services  []serviceState `json:"services"`
}

// serviceState is one member and what its container says right now.
type serviceState struct {
	Service string        `json:"service"`
	Kind    string        `json:"kind"`
	State   string        `json:"state"`
	Domains []string      `json:"domains,omitempty"`
	Port    int           `json:"port,omitempty"`
	Release string        `json:"release,omitempty"`
	Usage   *runner.Usage `json:"usage,omitempty"`
}

func (s *server) stackViewOf(st string, e state.StackEnv) stackView {
	v := stackView{Stack: st, Env: e.Env, Revision: e.Revision, Stopped: e.Stopped, Domain: e.BaseDomain}
	for _, r := range e.Revisions {
		v.Revisions = append(v.Revisions, r.Number)
	}
	for _, m := range s.store.StackMembers(st, e.Env) {
		ss := serviceState{Service: m.Service, Kind: m.ServiceKind, State: s.runner.State(m.Key()),
			Domains: m.Domains, Port: m.UpstreamPort(), Release: m.Release}
		if u, ok := s.runner.Usage(m.Key()); ok {
			ss.Usage = &u
		}
		v.Services = append(v.Services, ss)
	}
	sort.Slice(v.Services, func(i, j int) bool { return v.Services[i].Service < v.Services[j].Service })
	return v
}

func (s *server) handleStackList(w http.ResponseWriter, _ *http.Request) {
	var out []stackView
	for _, st := range s.store.Stacks() {
		for _, e := range st.Envs {
			out = append(out, s.stackViewOf(st.Name, e))
		}
	}
	if out == nil {
		out = []stackView{}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) handleStackShow(w http.ResponseWriter, r *http.Request) {
	name, env, ok := s.stackPath(w, r)
	if !ok {
		return
	}
	e, found := s.store.StackEnv(name, env)
	if !found {
		writeError(w, http.StatusNotFound, "unknown stack environment "+name+"/"+env)
		return
	}
	writeJSON(w, http.StatusOK, s.stackViewOf(name, e))
}

/*
handleStackRestart restarts one service: an app service blue/green, a
Compose service through Compose, in place.
*/
func (s *server) handleStackRestart(w http.ResponseWriter, r *http.Request) {
	name, env, ok := s.stackPath(w, r)
	if !ok {
		return
	}
	service := r.URL.Query().Get("service")
	member, found := s.store.Get(memberKey(name, env, service))
	if !found {
		writeError(w, http.StatusNotFound, name+"/"+env+" has no service "+service)
		return
	}
	var err error
	if member.ServiceKind == "app" {
		err = s.restart(member)
	} else {
		se, _ := s.store.StackEnv(name, env)
		err = stack.RestartService(stack.RevisionDir(s.root, name, env, se.Revision), naming.StackProject(name, env), service)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"restarted": name + "/" + env + "/" + service})
}

/*
handleStackVolumes lists each named volume with its size and the hooks that
cover it. A volume no hook covers says so: that is the list somebody needs
before they trust the backups.
*/
func (s *server) handleStackVolumes(w http.ResponseWriter, r *http.Request) {
	name, env, ok := s.stackPath(w, r)
	if !ok {
		return
	}
	lister, can := s.runner.(volumeLister)
	if !can {
		writeError(w, http.StatusNotImplemented, "this runner has no volumes")
		return
	}
	vols, err := lister.ProjectVolumes(naming.StackProject(name, env))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var sizes map[string]int64
	if sizer, ok := s.runner.(volumeSizer); ok {
		sizes, _ = sizer.VolumeSizes()
	}
	coverage := s.volumeCoverage(name, env)
	se, _ := s.store.StackEnv(name, env)
	out := make([]map[string]any, 0, len(vols))
	for _, v := range vols {
		row := map[string]any{"name": v.Name, "volume": v.Volume, "mountedBy": se.Volumes[v.Volume],
			"coveredBy": coverage[v.Volume], "backedUp": len(coverage[v.Volume]) > 0}
		if size, known := sizes[v.Name]; known && size >= 0 {
			row["sizeBytes"] = size
		}
		out = append(out, row)
	}
	writeJSON(w, http.StatusOK, map[string]any{"volumes": out,
		"notBackedUp": notBackedUpVolumes(s.uncoveredVolumes(name, env))})
}

/*
packBundle packs a bundle directory (the compose file and the files it
references) into a gzip tar for `bay stack deploy`. Version-control and
dependency directories are left out: a bundle is configuration.
*/
func packBundle(dir string) (string, error) {
	if _, err := stack.ComposeFile(dir); err != nil {
		return "", err
	}
	out, err := os.CreateTemp("", "bay-bundle-*.tar.gz")
	if err != nil {
		return "", err
	}
	defer out.Close()
	gz := gzip.NewWriter(out)
	tw := tar.NewWriter(gz)
	err = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(dir, path)
		if d.IsDir() {
			if d.Name() == ".git" || d.Name() == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if err := tw.WriteHeader(&tar.Header{Name: filepath.ToSlash(rel), Mode: 0o644, Size: info.Size(), Typeflag: tar.TypeReg}); err != nil {
			return err
		}
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(tw, f)
		return err
	})
	if err != nil {
		os.Remove(out.Name())
		return "", err
	}
	if err := tw.Close(); err != nil {
		return "", err
	}
	if err := gz.Close(); err != nil {
		return "", err
	}
	return out.Name(), nil
}

// cmdStackDeploy is `bay stack deploy <stack>/<env> [<dir>|<compose.yml>|<archive>|-] [--dry-run]`.
func cmdStackDeploy(args []string) error {
	if len(args) < 1 {
		return errors.New(stackUsage)
	}
	name, env, err := stackKeyOf(args[0])
	if err != nil {
		return err
	}
	query := neturl.Values{}
	var body io.Reader
	for _, a := range args[1:] {
		switch {
		case a == "--dry-run":
			query.Set("dryRun", "1")
		case a == "-":
			body = os.Stdin
		case strings.HasPrefix(a, "--"):
			return fmt.Errorf("unknown flag %s", a)
		default:
			path := a
			info, err := os.Stat(path)
			if err != nil {
				return err
			}
			if !info.IsDir() && isComposeName(filepath.Base(path)) {
				path = filepath.Dir(path)
				info, _ = os.Stat(path)
			}
			if info.IsDir() {
				packed, err := packBundle(path)
				if err != nil {
					return err
				}
				defer os.Remove(packed)
				path = packed
			}
			f, err := os.Open(path)
			if err != nil {
				return err
			}
			defer f.Close()
			body = f
		}
	}
	res, err := call(http.MethodPost, controlHost+"/stacks/"+name+"/"+env+"/deploy?"+query.Encode(), body)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

func isComposeName(base string) bool {
	switch base {
	case "compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml":
		return true
	}
	return false
}

// cmdStackRollback is `bay stack rollback <stack>/<env> --to N`.
func cmdStackRollback(args []string) error {
	if len(args) < 3 || args[1] != "--to" {
		return errors.New("usage: bay stack rollback <stack>/<env> --to N")
	}
	name, env, err := stackKeyOf(args[0])
	if err != nil {
		return err
	}
	res, err := call(http.MethodPost, controlHost+"/stacks/"+name+"/"+env+"/deploy?revision="+neturl.QueryEscape(args[2]), nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

// cmdStackShow covers `list`, `ps`, `volumes`, `logs` and `restart`.
func cmdStackShow(verb string, args []string) error {
	if verb == "list" {
		res, err := call(http.MethodGet, controlHost+"/stacks", nil)
		if err != nil {
			return err
		}
		var views []stackView
		if json.Unmarshal([]byte(res), &views) != nil {
			fmt.Println(res)
			return nil
		}
		for _, v := range views {
			state := "revision " + fmt.Sprint(v.Revision)
			if v.Stopped {
				state += ", stopped"
			}
			fmt.Printf("%s/%s  %s  %d service(s)  %s\n", v.Stack, v.Env, state, len(v.Services), v.Domain)
		}
		return nil
	}
	if len(args) < 1 {
		return errors.New(stackUsage)
	}
	name, env, err := stackKeyOf(args[0])
	if err != nil {
		return err
	}
	base := controlHost + "/stacks/" + name + "/" + env
	switch verb {
	case "ps":
		res, err := call(http.MethodGet, base, nil)
		if err != nil {
			return err
		}
		var v stackView
		if json.Unmarshal([]byte(res), &v) != nil {
			fmt.Println(res)
			return nil
		}
		fmt.Printf("%s/%s  revision %d\n", v.Stack, v.Env, v.Revision)
		for _, sv := range v.Services {
			fmt.Printf("  %-12s %-8s %-10s %s\n", sv.Service, sv.Kind, sv.State, strings.Join(sv.Domains, ", "))
		}
	case "volumes":
		res, err := call(http.MethodGet, base+"/volumes", nil)
		if err != nil {
			return err
		}
		var v struct {
			Volumes []struct {
				Volume    string   `json:"volume"`
				SizeBytes *int64   `json:"sizeBytes"`
				CoveredBy []string `json:"coveredBy"`
			} `json:"volumes"`
		}
		if json.Unmarshal([]byte(res), &v) != nil {
			fmt.Println(res)
			return nil
		}
		for _, vol := range v.Volumes {
			size := "?"
			if vol.SizeBytes != nil {
				size = humanBytes(*vol.SizeBytes)
			}
			covered := "NOT BACKED UP"
			if len(vol.CoveredBy) > 0 {
				covered = "backed up by " + strings.Join(vol.CoveredBy, ", ")
			}
			fmt.Printf("  %-20s %10s  %s\n", vol.Volume, size, covered)
		}
	case "logs":
		if len(args) < 2 {
			return errors.New("usage: bay stack logs <stack>/<env> <service> [-n 200]")
		}
		lines := "200"
		for i, a := range args {
			if a == "-n" && i+1 < len(args) {
				lines = args[i+1]
			}
		}
		res, err := call(http.MethodGet, controlHost+"/apps/"+state.MemberName(name, args[1])+"/"+env+"/logs?lines="+neturl.QueryEscape(lines), nil)
		if err != nil {
			return err
		}
		fmt.Println(res)
	case "restart":
		if len(args) < 2 {
			return errors.New("usage: bay stack restart <stack>/<env> <service>")
		}
		res, err := call(http.MethodPost, base+"/restart?service="+neturl.QueryEscape(args[1]), nil)
		if err != nil {
			return err
		}
		fmt.Println(res)
	}
	return nil
}

/*
cmdStackExec is `bay stack exec <stack>/<env> <service> <cmd...>`: a shell in
a service's container, for an operator on the host.

It never goes through the control API, on purpose: an exec is arbitrary
command execution, and the control API's verbs are what Lore's connector may
ask for. Reaching a container takes Docker access on this host, which is SSH.
*/
func cmdStackExec(args []string) error {
	if len(args) < 3 {
		return errors.New("usage: bay stack exec <stack>/<env> <service> <cmd...>")
	}
	name, env, err := stackKeyOf(args[0])
	if err != nil {
		return err
	}
	container := runner.ContainerName(memberKey(name, env, args[1]))
	cmd := exec.Command("docker", append([]string{"exec", "-it", container}, args[2:]...)...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	return cmd.Run()
}

/*
memberDeployArgs turns `bay deploy <stack>/<env>/<service> ...` into the
ordinary deploy of the member app: --name <stack>.<service> --env <env>.
*/
func memberDeployArgs(args []string) ([]string, bool) {
	if len(args) == 0 || strings.Count(args[0], "/") != 2 {
		return args, false
	}
	parts := strings.Split(args[0], "/")
	rest := append([]string{}, args[1:]...)
	return append(rest, "--name", state.MemberName(parts[0], parts[2]), "--env", parts[1]), true
}
