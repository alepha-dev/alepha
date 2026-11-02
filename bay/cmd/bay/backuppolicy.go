package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/alepha-dev/bay/internal/backuppolicy"
	"github.com/alepha-dev/bay/internal/state"
)

/*
The backup policy, in layers (see package backuppolicy):

	built-in  <  global  <  app  <  operator

  - built-in is what `serve` was started with: `--backup-interval` (0 turns
    scheduled backups off by default) and a retention of `defaultKeep`.
  - global is `bay config backup`, plus the older `bay config s3:backups
    --keep`, which still counts as the global retention when the policy itself
    sets none — so a host configured before policies existed prunes exactly as
    it did.
  - app is what the deploy declared (`bay deploy --backup-policy`), untrusted.
  - operator is `bay backup config <name/env>`, for one instance.

Every consumer — the scheduler, retention, `bay status`, the inventory —
reads `effectiveBackupPolicy`, so none of them can disagree about an app.
*/

func (s *server) builtInBackupLayer() backuppolicy.Layer {
	every := s.backupInterval
	if every <= 0 {
		// Off by default, but an app turned on by a higher layer without an
		// interval of its own still needs one.
		every = defaultBackupInterval
	}
	return backuppolicy.Layer{Source: backuppolicy.BuiltIn, Policy: &backuppolicy.Policy{
		Enabled:   backuppolicy.Bool(s.backupInterval > 0),
		Schedule:  &backuppolicy.Schedule{Every: backuppolicy.FormatDuration(every)},
		Retention: &backuppolicy.Retention{Keep: backuppolicy.Int(defaultKeep)},
	}}
}

func (s *server) globalBackupLayer() backuppolicy.Layer {
	var p backuppolicy.Policy
	if g := s.store.BackupPolicy(); g != nil {
		p = *g
	}
	if p.Retention == nil || p.Retention.Keep == nil {
		if cfg := s.store.S3(); cfg != nil && cfg.Keep > 0 {
			p.Retention = &backuppolicy.Retention{Keep: backuppolicy.Int(cfg.Keep)}
		}
	}
	return backuppolicy.Layer{Source: backuppolicy.Global, Policy: &p}
}

func (s *server) effectiveBackupPolicy(app state.App) backuppolicy.Effective {
	return backuppolicy.Resolve(
		s.builtInBackupLayer(),
		s.globalBackupLayer(),
		backuppolicy.Layer{Source: backuppolicy.App, Policy: app.BackupDeclared},
		backuppolicy.Layer{Source: backuppolicy.Operator, Policy: app.BackupOverride},
	)
}

// declaredBackupPolicy reads the app layer sent with a deploy. Empty declares
// nothing.
func declaredBackupPolicy(raw string) (*backuppolicy.Policy, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	p, err := backuppolicy.Decode([]byte(raw))
	if err != nil {
		return nil, err
	}
	if err := p.Validate(backuppolicy.App); err != nil {
		return nil, fmt.Errorf("backup policy declared by the app: %w", err)
	}
	return p.Normalize(), nil
}

// readPolicyBody decodes and validates an operator-written layer.
func readPolicyBody(r *http.Request, source backuppolicy.Source) (*backuppolicy.Policy, error) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<16))
	if err != nil {
		return nil, err
	}
	p, err := backuppolicy.Decode(raw)
	if err != nil {
		return nil, err
	}
	if err := p.Validate(source); err != nil {
		return nil, err
	}
	return p.Normalize(), nil
}

func (s *server) registerBackupPolicyRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /config/backup", s.handleGetGlobalBackupPolicy)
	mux.HandleFunc("PUT /config/backup", s.handlePutGlobalBackupPolicy)
	mux.HandleFunc("DELETE /config/backup", s.handleDeleteGlobalBackupPolicy)
	mux.HandleFunc("GET /apps/{name}/{env}/backup/config", s.handleGetAppBackupPolicy)
	mux.HandleFunc("PUT /apps/{name}/{env}/backup/config", s.handlePutAppBackupPolicy)
	mux.HandleFunc("DELETE /apps/{name}/{env}/backup/config", s.handleDeleteAppBackupPolicy)
}

func (s *server) globalPolicyView() map[string]any {
	return map[string]any{
		"builtIn": s.builtInBackupLayer().Policy,
		"global":  s.store.BackupPolicy(),
		// What an app that declares nothing and has no override gets.
		"effective": backuppolicy.Resolve(s.builtInBackupLayer(), s.globalBackupLayer()),
	}
}

func (s *server) handleGetGlobalBackupPolicy(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.globalPolicyView())
}

func (s *server) handlePutGlobalBackupPolicy(w http.ResponseWriter, r *http.Request) {
	p, err := readPolicyBody(r, backuppolicy.Global)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.store.SetBackupPolicy(p); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.log.Info("global backup policy set", "policy", policyLog(p))
	writeJSON(w, http.StatusOK, s.globalPolicyView())
}

func (s *server) handleDeleteGlobalBackupPolicy(w http.ResponseWriter, _ *http.Request) {
	if err := s.store.SetBackupPolicy(nil); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.log.Info("global backup policy cleared")
	writeJSON(w, http.StatusOK, s.globalPolicyView())
}

func (s *server) appPolicyView(app state.App) map[string]any {
	view := map[string]any{
		"app":       app.Key(),
		"declared":  app.BackupDeclared,
		"operator":  app.BackupOverride,
		"effective": s.effectiveBackupPolicy(app),
	}
	// Said rather than left to be inferred from a policy that reads "enabled":
	// with no Bay-managed database there is nothing for it to act on.
	if !app.Backups {
		view["note"] = "no Bay-managed database; the policy has nothing to back up"
	}
	return view
}

func (s *server) appForPolicy(w http.ResponseWriter, r *http.Request) (state.App, bool) {
	app, ok := s.store.Get(r.PathValue("name") + "/" + r.PathValue("env"))
	if !ok {
		writeError(w, http.StatusNotFound, "unknown app")
	}
	return app, ok
}

func (s *server) handleGetAppBackupPolicy(w http.ResponseWriter, r *http.Request) {
	if app, ok := s.appForPolicy(w, r); ok {
		writeJSON(w, http.StatusOK, s.appPolicyView(app))
	}
}

func (s *server) handlePutAppBackupPolicy(w http.ResponseWriter, r *http.Request) {
	app, ok := s.appForPolicy(w, r)
	if !ok {
		return
	}
	p, err := readPolicyBody(r, backuppolicy.Operator)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.setAppPolicy(w, app, p)
}

func (s *server) handleDeleteAppBackupPolicy(w http.ResponseWriter, r *http.Request) {
	if app, ok := s.appForPolicy(w, r); ok {
		s.setAppPolicy(w, app, nil)
	}
}

func (s *server) setAppPolicy(w http.ResponseWriter, app state.App, p *backuppolicy.Policy) {
	if err := s.store.SetBackupOverride(app.Key(), p); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	app.BackupOverride = p
	s.log.Info("backup policy set", "app", app.Key(), "operator", policyLog(p))
	writeJSON(w, http.StatusOK, s.appPolicyView(app))
}

// policyLine is the policy as `bay status` prints it, each value with the
// layer that set it: "every 6h (app), keep 14 (global)".
func policyLine(p backuppolicy.Effective) string {
	if !p.Enabled {
		return fmt.Sprintf("schedule off (%s) — only `bay backup` takes one; keep %s (%s)",
			p.Sources.Enabled, keepWords(p.Keep), p.Sources.Keep)
	}
	return fmt.Sprintf("every %s (%s), keep %s (%s)",
		backuppolicy.FormatDuration(p.Every), p.Sources.Every, keepWords(p.Keep), p.Sources.Keep)
}

func keepWords(keep int) string {
	if keep == 0 {
		return "all"
	}
	return strconv.Itoa(keep)
}

func policyLog(p *backuppolicy.Policy) string {
	if p == nil {
		return "(none)"
	}
	raw, _ := json.Marshal(p)
	return string(raw)
}

// ---------------------------------------------------------------------------
// client commands
// ---------------------------------------------------------------------------

const policyFlagsUsage = "[--every 6h|inherit] [--keep N|inherit] [--on|--off|--inherit-enabled] [--reset]"

// applyPolicyFlags edits a layer from command-line flags. Each field can be
// set, or handed back to the layer below with `inherit`.
func applyPolicyFlags(p *backuppolicy.Policy, args []string) error {
	if err := checkFlags(args,
		map[string]bool{"--on": true, "--off": true, "--inherit-enabled": true, "--reset": true},
		map[string]bool{"--every": true, "--keep": true}); err != nil {
		return err
	}
	if hasFlag(args, "--on") && hasFlag(args, "--off") {
		return errors.New("--on and --off contradict each other")
	}
	switch {
	case hasFlag(args, "--on"):
		p.Enabled = backuppolicy.Bool(true)
	case hasFlag(args, "--off"):
		p.Enabled = backuppolicy.Bool(false)
	case hasFlag(args, "--inherit-enabled"):
		p.Enabled = nil
	}
	for i := 0; i < len(args)-1; i++ {
		value := args[i+1]
		switch args[i] {
		case "--every":
			if value == "inherit" {
				p.Schedule = nil
				continue
			}
			if _, err := backuppolicy.ParseDuration(value); err != nil {
				return fmt.Errorf("--every: %w", err)
			}
			p.Schedule = &backuppolicy.Schedule{Every: value}
		case "--keep":
			if value == "inherit" {
				p.Retention = nil
				continue
			}
			keep, err := strconv.Atoi(value)
			if err != nil {
				return fmt.Errorf("--keep: %q is not a whole number (0 keeps every backup)", value)
			}
			p.Retention = &backuppolicy.Retention{Keep: backuppolicy.Int(keep)}
		}
	}
	return nil
}

// editPolicy is the read-modify-write both `config backup` and `backup config`
// share: no flags shows the layer, --reset deletes it, anything else edits
// only the fields named and leaves the others as they were.
func editPolicy(url, layerField string, args []string) error {
	if len(args) == 0 {
		res, err := call(http.MethodGet, url, nil)
		if err == nil {
			fmt.Println(res)
		}
		return err
	}
	if hasFlag(args, "--reset") {
		if len(args) > 1 {
			return errors.New("--reset clears the whole layer and takes no other flag")
		}
		res, err := call(http.MethodDelete, url, nil)
		if err == nil {
			fmt.Println(res)
		}
		return err
	}
	raw, err := call(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	var current map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &current); err != nil {
		return fmt.Errorf("reading the current policy: %w", err)
	}
	var p backuppolicy.Policy
	if layer := current[layerField]; len(layer) > 0 && string(layer) != "null" {
		if err := json.Unmarshal(layer, &p); err != nil {
			return fmt.Errorf("reading the current policy: %w", err)
		}
	}
	if err := applyPolicyFlags(&p, args); err != nil {
		return err
	}
	body, err := json.Marshal(p)
	if err != nil {
		return err
	}
	res, err := call(http.MethodPut, url, bytesReader(body))
	if err == nil {
		fmt.Println(res)
	}
	return err
}

// cmdConfigBackup: bay config backup [flags]
func cmdConfigBackup(args []string) error {
	return editPolicy(controlHost+"/config/backup", "global", args)
}

// cmdBackupConfig: bay backup config <name/env> [flags]
func cmdBackupConfig(args []string) error {
	key, err := appKeyArg(args, "bay backup config <name/env> "+policyFlagsUsage)
	if err != nil {
		return err
	}
	return editPolicy(controlHost+"/apps/"+key+"/backup/config", "operator", args[1:])
}

// readBackupPolicyFlag reads `bay deploy --backup-policy`: inline JSON, or the
// path of a file holding it.
func readBackupPolicyFlag(value string) (string, error) {
	if strings.HasPrefix(strings.TrimSpace(value), "{") {
		return value, nil
	}
	raw, err := os.ReadFile(value)
	if err != nil {
		return "", fmt.Errorf("--backup-policy: %w (pass inline JSON or a file path)", err)
	}
	return string(raw), nil
}

func hasFlag(args []string, flag string) bool {
	for _, a := range args {
		if a == flag {
			return true
		}
	}
	return false
}
