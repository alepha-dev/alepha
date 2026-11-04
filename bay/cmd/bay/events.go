package main

import "github.com/alepha-dev/bay/internal/state"

// emit spools an event for Lore. Never fails the caller: an event that
// cannot be written is a log line, the work it describes still happened.
// app nil is a machine-wide event (the backup target).
func (s *server) emit(kind string, app *state.App, data map[string]any) {
	if s.events == nil {
		return
	}
	name, env := "", ""
	if app != nil {
		name, env = app.Name, app.Env
	}
	if _, err := s.events.Append(kind, name, env, data); err != nil {
		s.log.Warn("could not spool an event for lore", "kind", kind, "err", err)
	}
}
