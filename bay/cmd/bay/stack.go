package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"

	"github.com/alepha-dev/bay/internal/deploy"
	"github.com/alepha-dev/bay/internal/stack"
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
  env unset <stack>/<env> KEY...     remove variables`

// cmdStack is `bay stack`.
func cmdStack(args []string) error {
	if len(args) < 1 {
		return errors.New(stackUsage)
	}
	switch args[0] {
	case "env":
		return cmdStackEnv(args[1:])
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
