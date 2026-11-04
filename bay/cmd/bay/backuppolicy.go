package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"

	"github.com/alepha-dev/bay/internal/backup"
	"github.com/alepha-dev/bay/internal/backuppolicy"
	"github.com/alepha-dev/bay/internal/state"
)

/*
The backup policy, in layers (see package backuppolicy):

	built-in  <  global  <  app  <  operator

  - built-in is what `serve` was started with: `--backup-interval` (0 turns
    scheduled backups off by default), in UTC, a retention of `defaultKeep`
    plus the last `defaultKeepPreDeploy` pre-deploy backups, tagged backups
    kept, Bay pruning, no backup on deploy.
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
		Enabled:  backuppolicy.Bool(s.backupInterval > 0),
		Schedule: &backuppolicy.Schedule{Every: backuppolicy.FormatDuration(every), Timezone: "UTC"},
		OnDeploy: backuppolicy.Bool(false),
		Retention: &backuppolicy.Retention{
			Keep:          backuppolicy.Int(defaultKeep),
			KeepPreDeploy: backuppolicy.Int(defaultKeepPreDeploy),
			KeepTagged:    backuppolicy.Bool(true),
		},
		Prune: backuppolicy.PruneBay,
		// A backup nobody has read back is a hope: test the newest one weekly.
		Verify: &backuppolicy.Verify{Every: defaultVerifyEvery},
	}}
}

// defaultVerifyEvery is how often the newest backup of each app is test-
// restored when no layer says otherwise.
const defaultVerifyEvery = "7d"

// defaultKeepPreDeploy is how many pre-deploy backups survive by default: the
// starting points of the last few releases, enough to step back through a
// bad week of deploys.
const defaultKeepPreDeploy = 5

// retentionRules turns a policy into what package backup prunes with.
//
// A policy that counts nothing but sets maxAge ("keep everything, for 400
// days") keeps every backup younger than that: as rules it is keep-all capped
// by maxAge, which package backup would otherwise refuse as keeping nothing in
// particular, and the bucket would grow forever.
func retentionRules(p backuppolicy.Effective) backup.Rules {
	keep := p.Keep
	if p.MaxAge > 0 && keep == 0 && p.Hourly == 0 && p.Daily == 0 && p.Weekly == 0 && p.Monthly == 0 && p.Yearly == 0 {
		keep = backuppolicy.MaxKeep
	}
	return backup.Rules{
		Keep: keep, Hourly: p.Hourly, Daily: p.Daily, Weekly: p.Weekly, Monthly: p.Monthly, Yearly: p.Yearly,
		MaxAge: p.MaxAge, KeepPreDeploy: p.KeepPreDeploy, KeepTagged: p.KeepTagged, Location: p.Location(),
	}
}

func (s *server) globalBackupLayer() backuppolicy.Layer {
	var p backuppolicy.Policy
	if g := s.store.BackupPolicy(); g != nil {
		p = *g
	}
	if p.Retention == nil || p.Retention.Keep == nil {
		if cfg := s.store.S3(); cfg != nil && cfg.Keep > 0 {
			// Fill only keep: the other rules (daily, weekly…) stay. A copy, so
			// the stored policy is not changed under the store.
			var r backuppolicy.Retention
			if p.Retention != nil {
				r = *p.Retention
			}
			r.Keep = backuppolicy.Int(cfg.Keep)
			p.Retention = &r
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
	app, err := s.applyOperatorPolicy(app, p, "cli")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.appPolicyView(app))
}

// applyOperatorPolicy stores (or, with nil, clears) the operator layer of an
// instance's policy, logs it and tells Lore what changed, from what to what.
func (s *server) applyOperatorPolicy(app state.App, p *backuppolicy.Policy, by string) (state.App, error) {
	before := policyLine(s.effectiveBackupPolicy(app))
	if err := s.store.SetBackupOverride(app.Key(), p); err != nil {
		return app, err
	}
	app.BackupOverride = p
	after := policyLine(s.effectiveBackupPolicy(app))
	s.log.Info("backup policy set", "app", app.Key(), "operator", policyLog(p), "by", by)
	s.emit("backup.policy-changed", &app, map[string]any{"by": by, "before": clip(before), "after": clip(after), "cleared": p == nil})
	return app, nil
}

// policyLine is the policy as `bay status` prints it, each part with the
// layer that set it: "every 6h (app); keep 14, 7 daily (global)".
func policyLine(p backuppolicy.Effective) string {
	retention := p.RetentionWords() + " (" + retentionSources(p) + ")"
	if p.Prune == backuppolicy.PruneLifecycle {
		retention = "pruned by the bucket's lifecycle rules (" + string(p.Sources.Prune) + ")"
	}
	when := p.ScheduleWords() + " (" + string(p.Sources.Schedule) + ")"
	if !p.Enabled {
		when = "schedule off (" + string(p.Sources.Enabled) + ") — only `bay backup` takes one"
	}
	if p.OnDeploy {
		when += ", and before each deploy (" + string(p.Sources.OnDeploy) + ")"
	}
	return when + "; " + retention + "; " + p.VerifyWords() + " (" + string(p.Sources.Verify) + ")"
}

// retentionSources names every layer behind a retention rule in force, so
// "keep 14 (global)" with an operator's "10 daily" reads "global, operator".
func retentionSources(p backuppolicy.Effective) string {
	var out []string
	for _, r := range []struct {
		set bool
		src backuppolicy.Source
	}{
		{p.Keep > 0, p.Sources.Keep}, {p.Hourly > 0, p.Sources.Hourly}, {p.Daily > 0, p.Sources.Daily},
		{p.Weekly > 0, p.Sources.Weekly}, {p.Monthly > 0, p.Sources.Monthly}, {p.Yearly > 0, p.Sources.Yearly},
		{p.MaxAge > 0, p.Sources.MaxAge},
	} {
		if r.set && r.src != "" && !slices.Contains(out, string(r.src)) {
			out = append(out, string(r.src))
		}
	}
	if len(out) == 0 {
		return string(p.Sources.Keep)
	}
	return strings.Join(out, ", ")
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

const policyFlagsUsage = "[--on|--off|--inherit-enabled] [--every 6h | --at 03:00,15:00 | --cron EXPR] " +
	"[--tz ZONE] [--jitter D] [--window HH:MM-HH:MM|any] [--min-gap D] [--on-deploy|--no-on-deploy] " +
	"[--keep N] [--hourly N] [--daily N] [--weekly N] [--monthly N] [--yearly N] [--max-age D|0] " +
	"[--keep-pre-deploy N] [--keep-tagged true|false] [--prune bay|lifecycle] [--verify-every D|off] [--reset]"

// policyValueFlags are the flags taking a value; every one also accepts
// `inherit`, which hands the field back to the layer below.
var policyValueFlags = map[string]bool{
	"--every": true, "--at": true, "--cron": true, "--tz": true, "--jitter": true,
	"--window": true, "--min-gap": true, "--keep": true, "--hourly": true, "--daily": true,
	"--weekly": true, "--monthly": true, "--yearly": true, "--max-age": true,
	"--keep-pre-deploy": true, "--keep-tagged": true, "--prune": true, "--verify-every": true,
}

/*
applyPolicyFlags edits a layer from command-line flags. Only the fields named
change. --every, --at and --cron each replace the schedule's shape (the
timezone and jitter stay); `--every inherit` (or --at, --cron) hands the
shape back to the layer below.
*/
func applyPolicyFlags(p *backuppolicy.Policy, args []string) error {
	if err := checkFlags(args,
		map[string]bool{"--on": true, "--off": true, "--inherit-enabled": true, "--reset": true,
			"--on-deploy": true, "--no-on-deploy": true},
		policyValueFlags); err != nil {
		return err
	}
	if hasFlag(args, "--on") && hasFlag(args, "--off") {
		return errors.New("--on and --off contradict each other")
	}
	if hasFlag(args, "--on-deploy") && hasFlag(args, "--no-on-deploy") {
		return errors.New("--on-deploy and --no-on-deploy contradict each other")
	}
	shapes := 0
	for _, f := range []string{"--every", "--at", "--cron"} {
		if hasFlag(args, f) {
			shapes++
		}
	}
	if shapes > 1 {
		return errors.New("--every, --at and --cron are three ways to say when: pick one")
	}
	switch {
	case hasFlag(args, "--on"):
		p.Enabled = backuppolicy.Bool(true)
	case hasFlag(args, "--off"):
		p.Enabled = backuppolicy.Bool(false)
	case hasFlag(args, "--inherit-enabled"):
		p.Enabled = nil
	}
	switch {
	case hasFlag(args, "--on-deploy"):
		p.OnDeploy = backuppolicy.Bool(true)
	case hasFlag(args, "--no-on-deploy"):
		p.OnDeploy = backuppolicy.Bool(false)
	}
	if p.Schedule == nil {
		p.Schedule = &backuppolicy.Schedule{}
	}
	if p.Retention == nil {
		p.Retention = &backuppolicy.Retention{}
	}
	sc, r := p.Schedule, p.Retention
	count := func(flag, value string) (*int, error) {
		if value == "inherit" {
			return nil, nil
		}
		n, err := strconv.Atoi(value)
		if err != nil || n < 0 {
			return nil, fmt.Errorf("%s: %q is not a whole number", flag, value)
		}
		return backuppolicy.Int(n), nil
	}
	text := func(value string) string {
		if value == "inherit" {
			return ""
		}
		return value
	}
	for i := 0; i < len(args)-1; i++ {
		flag, value := args[i], args[i+1]
		if !policyValueFlags[flag] {
			continue
		}
		i++
		var err error
		switch flag {
		case "--every", "--at", "--cron":
			sc.Every, sc.At, sc.Cron = "", nil, ""
			switch {
			case value == "inherit":
			case flag == "--every":
				sc.Every = value
			case flag == "--at":
				sc.At = strings.Split(value, ",")
			default:
				sc.Cron = value
			}
		case "--tz":
			sc.Timezone = text(value)
		case "--jitter":
			sc.Jitter = text(value)
		case "--window":
			p.Window = text(value)
		case "--min-gap":
			p.MinGap = text(value)
		case "--prune":
			p.Prune = text(value)
		case "--max-age":
			r.MaxAge = text(value)
		case "--verify-every":
			if value == "inherit" {
				p.Verify = nil
			} else {
				p.Verify = &backuppolicy.Verify{Every: value}
			}
		case "--keep":
			r.Keep, err = count(flag, value)
		case "--hourly":
			r.Hourly, err = count(flag, value)
		case "--daily":
			r.Daily, err = count(flag, value)
		case "--weekly":
			r.Weekly, err = count(flag, value)
		case "--monthly":
			r.Monthly, err = count(flag, value)
		case "--yearly":
			r.Yearly, err = count(flag, value)
		case "--keep-pre-deploy":
			r.KeepPreDeploy, err = count(flag, value)
		case "--keep-tagged":
			switch value {
			case "inherit":
				r.KeepTagged = nil
			case "true", "false":
				r.KeepTagged = backuppolicy.Bool(value == "true")
			default:
				err = fmt.Errorf("--keep-tagged: %q is not true, false or inherit", value)
			}
		}
		if err != nil {
			return err
		}
	}
	if n := p.Normalize(); n != nil {
		*p = *n
	} else {
		*p = backuppolicy.Policy{}
	}
	// Checked here as well as by the server, so a typo is answered before
	// anything is sent. Global and operator layers obey the same bounds.
	return p.Validate(backuppolicy.Operator)
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

// flagValue is the value after flag, empty when the flag is absent.
func flagValue(args []string, flag string) string {
	for i := 0; i < len(args)-1; i++ {
		if args[i] == flag {
			return args[i+1]
		}
	}
	return ""
}
