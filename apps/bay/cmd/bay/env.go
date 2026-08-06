package main

// `bay env` — the way a remote caller sets an app's own environment.
//
// Everything Bay needed to hold a user's secret already existed: the instance
// `.env` outlives releases, and `provision` merges into it rather than
// rewriting it, precisely so a redeploy cannot wipe STRIPE_KEY. What was
// missing was a door. The file is 0600 and owned by the app's unix user, so
// the deploy user reaching the host over ssh cannot write it — which left
// `alepha platform up` with a documented `secrets()` hook and nothing to call.
//
// Values arrive on STDIN, never in argv. An argument is visible in `ps` to
// every user on the machine and lands in the caller's shell history; `bay
// deploy -` already established stdin as this codebase's channel for a
// payload, and a secret has a stronger claim on it than a tarball does.

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/alepha/bay/internal/deploy"
)

// maxEnvPayloadBytes bounds one `bay env set` body.
//
// The whole payload is parsed in memory while the supervisor holds its lock, so
// it is bounded for the same reason `maxLogRequest` is. A megabyte is far more
// than a set of secrets and far less than anything that could stall the host.
const maxEnvPayloadBytes int64 = 1 << 20

func (s *server) registerEnvRoutes(mux *http.ServeMux) {
	mux.HandleFunc("PUT /apps/{name}/{env}/env", s.handleSetEnv)
	mux.HandleFunc("GET /apps/{name}/{env}/env", s.handleListEnv)
}

// envResponse is what a set reports back.
//
// `restarted` is part of the contract, not a diagnostic. An environment
// variable that never reaches the running process is a no-op that reads as a
// success, so the caller is told in as many words whether the process it is
// configuring has actually seen the change.
type envResponse struct {
	// Changed is the keys whose value is now different, by name.
	Changed []string `json:"changed"`
	// Restarted says the app is running on the new environment.
	Restarted bool `json:"restarted"`
	// Note explains any answer where `restarted` is false, so "the app did not
	// restart" is never left for the reader to interpret.
	Note string `json:"note,omitempty"`
}

func (s *server) handleSetEnv(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("name") + "/" + r.PathValue("env")
	app, ok := s.store.Get(key)
	if !ok {
		writeError(w, http.StatusNotFound, "unknown app")
		return
	}
	// A static site has no process and no `.env` — `provision` skips both. An
	// environment variable set on one would sit in a file nothing ever reads,
	// forever. Refused rather than stored.
	if app.Static {
		writeError(w, http.StatusBadRequest,
			key+" is a static site: it has no process, so it has no environment. "+
				"Anything it needs at build time belongs in the artifact.")
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, maxEnvPayloadBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "read payload: "+err.Error())
		return
	}
	if int64(len(body)) > maxEnvPayloadBytes {
		writeError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("payload is over the %d-byte limit", maxEnvPayloadBytes))
		return
	}
	updates, err := deploy.ParseAssignments(strings.NewReader(string(body)))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	instance := s.instanceDir(app)
	changed, err := deploy.SetEnv(instance, updates)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(changed) == 0 {
		// Nothing moved, so nothing is restarted. `alepha platform up` sends
		// the same secrets on every deploy; restarting for a file that did not
		// change would buy an outage window for nothing.
		writeJSON(w, http.StatusOK, envResponse{
			Changed: []string{}, Restarted: false,
			Note: "every value was already set to this — nothing was written and nothing restarted",
		})
		return
	}
	s.log.Info("app environment updated", "app", key, "keys", changed)

	if !s.runner.Running(key) {
		// Deliberately not started. Whoever stopped this app owns that
		// decision, and `bay env set` is not the command that reverses it.
		writeJSON(w, http.StatusOK, envResponse{
			Changed: changed, Restarted: false,
			Note: "the app is not running, so the new environment takes effect the next time it starts",
		})
		return
	}

	// Requests wait rather than 502, the same way they do through a deploy.
	defer s.holdDuring(key)()
	if err := s.runner.Stop(key, stopGrace); err != nil {
		writeError(w, http.StatusInternalServerError,
			"the environment is written but the app would not stop, so it is still running the old one: "+err.Error())
		return
	}
	if err := s.start(app); err != nil {
		writeError(w, http.StatusInternalServerError,
			"the environment is written but the app did not come back up: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, envResponse{Changed: changed, Restarted: true})
}

func (s *server) handleListEnv(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("name") + "/" + r.PathValue("env")
	app, ok := s.store.Get(key)
	if !ok {
		writeError(w, http.StatusNotFound, "unknown app")
		return
	}
	if app.Static {
		// Not an error: a static site legitimately has no environment, and a
		// caller listing one wants that answer rather than a failure.
		writeJSON(w, http.StatusOK, map[string]any{
			"app": []string{}, "bayOwned": []string{}, "static": true,
		})
		return
	}
	appKeys, bayKeys, err := deploy.EnvKeys(s.instanceDir(app))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Names only, never values — the same rule `GET /config/storage` follows.
	// Something that can already call this API must not be able to read
	// credentials out of it.
	writeJSON(w, http.StatusOK, map[string]any{
		"app": appKeys, "bayOwned": bayKeys,
	})
}

// ---------------------------------------------------------------------------
// client commands
// ---------------------------------------------------------------------------

const envSetUsage = "usage: bay env set <name/env> (-|FILE)   # KEY=VALUE lines, read from stdin"

func cmdEnvSet(args []string) error {
	if len(args) < 2 {
		return errors.New(envSetUsage + "\n" +
			"  e.g. ssh HOST 'bay env set demo/production -' < .env.production")
	}
	key, err := appKeyArg(args, envSetUsage)
	if err != nil {
		return err
	}
	source := args[1]
	// A caller reaching for `bay env set app/production FOO=bar` has to be told
	// why that is not offered, not handed "no such file or directory: FOO=bar".
	if strings.Contains(source, "=") {
		return errors.New(
			"values are read from stdin, never from the command line: an argument is visible in `ps` " +
				"to every user on this machine and is kept in the caller's shell history.\n" +
				envSetUsage)
	}
	if err := checkFlags(args[2:],
		map[string]bool{},
		map[string]bool{"--control-socket": true}); err != nil {
		return err
	}

	body, closeBody, err := artifactBody(source, os.Stdin)
	if err != nil {
		return err
	}
	defer closeBody()

	res, err := call(http.MethodPut, controlHost+"/apps/"+key+"/env", body)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

func cmdEnvList(args []string) error {
	key, err := appKeyArg(args, "bay env list <name/env>")
	if err != nil {
		return err
	}
	res, err := call(http.MethodGet, controlHost+"/apps/"+key+"/env", nil)
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}
