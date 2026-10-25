package main

import (
	"sort"

	"github.com/alepha-dev/bay/internal/state"
)

/*
volumeCoverage answers, for each named volume of a stack environment, the
services mounting it whose `x-lore.backup` hook covers it. A volume with an
empty list is one no backup touches.
*/
func (s *server) volumeCoverage(name, env string) map[string][]string {
	se, ok := s.store.StackEnv(name, env)
	if !ok {
		return nil
	}
	hooked := map[string]bool{}
	for _, m := range s.store.StackMembers(name, env) {
		if m.BackupHook != nil {
			hooked[m.Service] = true
		}
	}
	out := make(map[string][]string, len(se.Volumes))
	for volume, services := range se.Volumes {
		out[volume] = []string{}
		for _, svc := range services {
			if hooked[svc] {
				out[volume] = append(out[volume], svc)
			}
		}
	}
	return out
}

// uncoveredVolumes lists the volumes of a stack environment no hook covers, sorted.
func (s *server) uncoveredVolumes(name, env string) []string {
	var out []string
	for volume, by := range s.volumeCoverage(name, env) {
		if len(by) == 0 {
			out = append(out, volume)
		}
	}
	sort.Strings(out)
	return out
}

// uncoveredFor lists the uncovered volumes one member mounts, for its status line.
func (s *server) uncoveredFor(app state.App) []string {
	if app.Stack == "" {
		return nil
	}
	se, _ := s.store.StackEnv(app.Stack, app.Env)
	var out []string
	for _, volume := range s.uncoveredVolumes(app.Stack, app.Env) {
		for _, svc := range se.Volumes[volume] {
			if svc == app.Service {
				out = append(out, volume)
			}
		}
	}
	return out
}

// notBackedUpVolumes words the uncovered volumes for a backup response.
func notBackedUpVolumes(volumes []string) []string {
	out := make([]string, 0, len(volumes))
	for _, v := range volumes {
		out = append(out, "not backed up: volume "+v+" (no service mounting it declares x-lore.backup)")
	}
	return out
}
