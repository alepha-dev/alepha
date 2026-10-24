package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/alepha-dev/bay/internal/naming"
	"github.com/alepha-dev/bay/internal/runner"
	"github.com/alepha-dev/bay/internal/stack"
	"github.com/alepha-dev/bay/internal/state"
)

// volumeLister is the runner's ability to list a project's volumes.
type volumeLister interface {
	ProjectVolumes(project string) ([]runner.ProjectVolume, error)
}

// imageRemover is the runner's ability to delete an image.
type imageRemover interface {
	RemoveImage(ref string) error
}

/*
stopStack takes a stack environment out of service, durably: Compose stops its
services, every app member is parked, and the intent is recorded on the
environment and on each app member, so neither a reboot nor a Bay upgrade
brings it back. Its TCP ports close.
*/
func (s *server) stopStack(name, env string) error {
	se, ok := s.store.StackEnv(name, env)
	if !ok {
		return fmt.Errorf("unknown stack environment %s/%s", name, env)
	}
	defer lockStack(name, env)()
	if err := s.store.MutateStackEnv(name, env, func(e *state.StackEnv) error { e.Stopped = true; return nil }); err != nil {
		return err
	}
	for _, m := range s.store.StackMembers(name, env) {
		if m.ServiceKind != "app" {
			continue
		}
		if err := s.store.SetStopped(m.Key(), true); err != nil {
			return err
		}
		if err := s.runner.Park(m.Key(), stopGrace); err != nil {
			return err
		}
	}
	if se.Revision > 0 {
		if err := stack.Stop(stack.RevisionDir(s.root, name, env, se.Revision), naming.StackProject(name, env)); err != nil {
			return err
		}
	}
	s.syncTCP()
	return nil
}

/*
startStack puts a stopped stack environment back: the current revision is
applied again (services first, healthy, then apps), and the intents cleared.
*/
func (s *server) startStack(name, env string) error {
	se, ok := s.store.StackEnv(name, env)
	if !ok {
		return fmt.Errorf("unknown stack environment %s/%s", name, env)
	}
	if err := s.store.MutateStackEnv(name, env, func(e *state.StackEnv) error { e.Stopped = false; return nil }); err != nil {
		return err
	}
	for _, m := range s.store.StackMembers(name, env) {
		if m.ServiceKind == "app" && m.Stopped {
			if err := s.store.SetStopped(m.Key(), false); err != nil {
				return err
			}
		}
	}
	if se.Revision == 0 {
		return nil
	}
	_, err := s.deployStack(context.Background(), stackDeployOptions{Stack: name, Env: env})
	return err
}

/*
destroyStack removes a stack environment's containers and forgets it.

Volumes are data, so they are kept unless `purge`; so are its variables and
registry credentials, so a later deploy of the same environment finds them.
A purge deletes all of it and answers the volumes it deleted, by name.
*/
func (s *server) destroyStack(name, env string, purge bool) ([]string, error) {
	se, ok := s.store.StackEnv(name, env)
	if !ok {
		return nil, fmt.Errorf("unknown stack environment %s/%s", name, env)
	}
	defer lockStack(name, env)()
	project := naming.StackProject(name, env)
	var volumes []string
	if lister, ok := s.runner.(volumeLister); ok {
		vols, err := lister.ProjectVolumes(project)
		if err != nil {
			return nil, err
		}
		for _, v := range vols {
			volumes = append(volumes, v.Name)
		}
	}
	for _, m := range s.store.StackMembers(name, env) {
		if m.ServiceKind == "app" {
			_ = s.runner.Stop(m.Key(), stopGrace)
			if err := s.runner.Remove(m.Key(), purge); err != nil {
				return nil, err
			}
		}
	}
	dir := stack.Dir(s.root, name, env)
	if se.Revision > 0 {
		if err := stack.Down(stack.RevisionDir(s.root, name, env, se.Revision), project, purge); err != nil {
			return nil, err
		}
	}
	if err := s.store.RemoveStackEnv(name, env); err != nil {
		return nil, err
	}
	if purge {
		_ = os.RemoveAll(dir)
	} else {
		_ = os.RemoveAll(filepath.Join(dir, "revisions"))
		volumes = nil
	}
	s.syncTCP()
	return volumes, nil
}

/*
pruneStack keeps the current revision and the ones before it up to the kept
count, deleting older revision directories and records, and then every image
only those revisions pinned. An image a kept revision or a running container
still uses is never removed.
*/
func (s *server) pruneStack(name, env string) []string {
	se, ok := s.store.StackEnv(name, env)
	keep := s.keepReleases
	if !ok || keep <= 0 {
		return nil
	}
	sort.Slice(se.Revisions, func(i, j int) bool { return se.Revisions[i].Number > se.Revisions[j].Number })
	kept := map[int]bool{se.Revision: true}
	for _, r := range se.Revisions {
		if len(kept) >= keep {
			break
		}
		kept[r.Number] = true
	}
	inUse := map[string]bool{}
	var dropped []state.StackRevision
	for _, r := range se.Revisions {
		if kept[r.Number] {
			for _, ref := range r.Digests {
				inUse[ref] = true
			}
			continue
		}
		dropped = append(dropped, r)
	}
	if len(dropped) == 0 {
		return nil
	}
	_ = s.store.MutateStackEnv(name, env, func(e *state.StackEnv) error {
		var left []state.StackRevision
		for _, r := range e.Revisions {
			if kept[r.Number] {
				left = append(left, r)
			}
		}
		e.Revisions = left
		return nil
	})
	var removed []string
	remover, canRemove := s.runner.(imageRemover)
	for _, r := range dropped {
		_ = os.RemoveAll(stack.RevisionDir(s.root, name, env, r.Number))
		removed = append(removed, "revision "+strconv.Itoa(r.Number))
		if !canRemove {
			continue
		}
		for _, ref := range r.Digests {
			if inUse[ref] {
				continue
			}
			if err := remover.RemoveImage(ref); err == nil {
				inUse[ref] = true
			}
		}
	}
	return removed
}

func (s *server) handleStackStop(w http.ResponseWriter, r *http.Request) {
	name, env, ok := s.stackPath(w, r)
	if !ok {
		return
	}
	if err := s.stopStack(name, env); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"stopped": name + "/" + env})
}

func (s *server) handleStackStart(w http.ResponseWriter, r *http.Request) {
	name, env, ok := s.stackPath(w, r)
	if !ok {
		return
	}
	if err := s.startStack(name, env); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"started": name + "/" + env})
}

/*
handleStackDestroy needs `confirm=<stack>/<env>` to purge: deleting volumes
is the one stack operation that cannot be undone, so the caller names what it
is deleting. Without the confirmation a purge answers 409 with the volumes it
would delete.
*/
func (s *server) handleStackDestroy(w http.ResponseWriter, r *http.Request) {
	name, env, ok := s.stackPath(w, r)
	if !ok {
		return
	}
	purge := r.URL.Query().Get("purge") == "1"
	if purge && r.URL.Query().Get("confirm") != name+"/"+env {
		var volumes []string
		if lister, ok := s.runner.(volumeLister); ok {
			vols, _ := lister.ProjectVolumes(naming.StackProject(name, env))
			for _, v := range vols {
				volumes = append(volumes, v.Name)
			}
		}
		writeError(w, http.StatusConflict, "a purge deletes the volumes of "+name+"/"+env+
			" and cannot be undone; confirm it by naming the environment", map[string]any{"volumes": volumes})
		return
	}
	deleted, err := s.destroyStack(name, env, purge)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"destroyed": name + "/" + env, "volumesDeleted": deleted})
}

func cmdStackLifecycle(verb string, args []string) error {
	if len(args) < 1 {
		return errors.New(stackUsage)
	}
	name, env, err := stackKeyOf(args[0])
	if err != nil {
		return err
	}
	base := controlHost + "/stacks/" + name + "/" + env
	switch verb {
	case "stop", "start":
		res, err := call(http.MethodPost, base+"/"+verb, nil)
		if err != nil {
			return err
		}
		fmt.Println(res)
	case "destroy":
		purge := false
		confirm := ""
		for _, a := range args[1:] {
			if a == "--purge" {
				purge = true
			}
			if a == "--yes" {
				confirm = name + "/" + env
			}
		}
		if purge && confirm == "" {
			fmt.Fprintf(os.Stderr, "This deletes every volume of %s/%s. Type %s/%s to confirm: ", name, env, name, env)
			var typed string
			_, _ = fmt.Scanln(&typed)
			if strings.TrimSpace(typed) != name+"/"+env {
				return errors.New("not confirmed; nothing was deleted")
			}
			confirm = typed
		}
		query := ""
		if purge {
			query = "?purge=1&confirm=" + confirm
		}
		res, err := call(http.MethodDelete, base+query, nil)
		if err != nil {
			return err
		}
		fmt.Println(res)
	}
	return nil
}

// volumeSizer is the runner's ability to say how much disk each volume uses.
type volumeSizer interface {
	VolumeSizes() (map[string]int64, error)
}
