package main

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"os"
	"strings"
	"time"

	"github.com/alepha-dev/bay/internal/deploy"
	"github.com/alepha-dev/bay/internal/state"
)

/*
`bay secret replace <name/env> APP_SECRET -`: the one deliberate way to put a
known key on an instance, for a host that already minted the wrong one (a
rebuilt host whose snapshots predate keys in backups).

Deliberately narrow:
  - APP_SECRET only, and the value on stdin only: an argument lands in shell
    history and in `ps`;
  - the control API refuses it without ?confirm=yes, like a restore, so a
    caller that skips the CLI's prompt cannot skip the confirmation;
  - audited without a person (the control socket carries no identity): the
    log line and the event name when, which instance, and the way in;
  - `bay env set` and a deploy's secrets file keep refusing the name.

Lore follows on the next deploy from Lore, through the escrow, which then says
it replaced a different key: no channel outside a deploy command may carry a
key.
*/

const secretReplaceUsage = "usage: bay secret replace <name/env> APP_SECRET - [--yes]   # the key on stdin"

// maxSecretBody bounds what the replace endpoint reads; a key is far smaller.
const maxSecretBody = 8 << 10

func (s *server) registerSecretRoutes(mux *http.ServeMux) {
	mux.HandleFunc("PUT /apps/{name}/{env}/secret/{key}", s.handleReplaceSecret)
}

func (s *server) handleReplaceSecret(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("name") + "/" + r.PathValue("env")
	app, ok := s.store.Get(key)
	if !ok {
		writeError(w, http.StatusNotFound, "unknown app")
		return
	}
	if r.PathValue("key") != "APP_SECRET" {
		writeError(w, http.StatusBadRequest, "only APP_SECRET can be replaced this way; the app's own variables go through `bay env set`")
		return
	}
	if app.Static {
		writeError(w, http.StatusBadRequest, key+" is a static site: it has no process, so it has no APP_SECRET")
		return
	}
	if r.URL.Query().Get("confirm") != "yes" {
		writeError(w, http.StatusPreconditionRequired, replaceCost(key)+"; repeat with ?confirm=yes")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxSecretBody+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "read the key: "+err.Error())
		return
	}
	if len(body) > maxSecretBody {
		writeError(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("the key is over %d bytes", maxSecretBody))
		return
	}
	value := strings.TrimRight(string(body), "\r\n")
	if err := deploy.CheckAppSecret(value); err != nil {
		writeError(w, http.StatusBadRequest, "refusing the key: "+err.Error())
		return
	}

	// A deploy or a restore swapping things under it leaves an app nobody
	// can describe.
	if holder, ok := s.claimInstance(key, "secret replace"); !ok {
		writeError(w, http.StatusConflict, key+" is busy ("+holder+"): try again once it is done")
		return
	}
	defer s.releaseInstance(key)

	instance := s.instanceDir(app)
	current, err := deploy.ReadAppSecret(instance)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read the current key: "+err.Error())
		return
	}
	if current == value {
		writeJSON(w, http.StatusOK, map[string]any{"app": key, "replaced": false, "restarted": false,
			"note": "the instance already runs on this key: nothing was written and nothing restarted"})
		return
	}
	if err := deploy.InstallAppSecret(instance, value); err != nil {
		writeError(w, http.StatusInternalServerError, "write the key: "+err.Error())
		return
	}
	now := time.Now()
	if err := s.store.SetAppSecretSource(key, state.SecretReplaced, "cli", "", now); err != nil {
		s.log.Error("could not record the replaced APP_SECRET", "app", key, "err", err)
	}
	// The audit: when, which instance, the way in. Never the value.
	s.log.Warn("APP_SECRET replaced by hand; every session is signed out", "app", key, "by", "cli")
	s.emit("appsecret.replaced", &app, map[string]any{"by": "cli"})

	resp := map[string]any{
		"app": key, "replaced": true, "appSecret": state.SecretReplaced,
		"lore": "Lore, if this instance deploys from it, still holds the previous key until the next deploy from Lore, " +
			"which replaces it and says so on that deploy's log",
	}
	if !s.runner.Running(key) {
		// Whoever stopped it owns that decision, as with `bay env set`.
		resp["restarted"] = false
		resp["note"] = "the app is not running, so the new key takes effect the next time it starts"
		writeJSON(w, http.StatusOK, resp)
		return
	}
	if err := s.restart(app); err != nil {
		writeError(w, http.StatusInternalServerError, "the key is written but the app did not come back up on it: "+err.Error())
		return
	}
	resp["restarted"] = true
	writeJSON(w, http.StatusOK, resp)
}

func replaceCost(key string) string {
	return "replacing the APP_SECRET of " + key + " signs every session out, makes anything sealed with the current key " +
		"(MFA enrolled since) unreadable, and the current key is gone for good"
}

func cmdSecretReplace(args []string) error {
	if len(args) < 3 {
		return errors.New(secretReplaceUsage)
	}
	key, err := appKeyArg(args, secretReplaceUsage)
	if err != nil {
		return err
	}
	if args[1] != "APP_SECRET" {
		return errors.New("only APP_SECRET can be replaced this way; the app's own variables go through `bay env set`\n" + secretReplaceUsage)
	}
	if args[2] != "-" {
		return errors.New("the key is read from stdin, never from the command line: an argument is visible in `ps` " +
			"to every user on this machine and is kept in the caller's shell history.\n" + secretReplaceUsage)
	}
	if err := checkFlags(args[3:], map[string]bool{"--yes": true}, map[string]bool{"--control-socket": true}); err != nil {
		return err
	}
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, maxSecretBody+1))
	if err != nil {
		return fmt.Errorf("read the key from stdin: %w", err)
	}
	value := strings.TrimRight(string(raw), "\r\n")
	if err := deploy.CheckAppSecret(value); err != nil {
		return fmt.Errorf("refusing the key on stdin: %w", err)
	}
	if !hasFlag(args, "--yes") {
		// Stdin holds the key, so the confirmation is asked on the terminal.
		tty, err := os.OpenFile("/dev/tty", os.O_RDWR, 0)
		if err != nil {
			return errors.New("not confirmed: no terminal to ask on. " + replaceCost(key) + "; pass --yes to confirm")
		}
		defer tty.Close()
		fmt.Fprintf(tty, "%s. Type %s to confirm: ", capitalise(replaceCost(key)), key)
		typed, _ := bufio.NewReader(tty).ReadString('\n')
		if strings.TrimSpace(typed) != key {
			return errors.New("not confirmed; the key was not replaced")
		}
	}
	q := neturl.Values{"confirm": {"yes"}}
	res, err := call(http.MethodPut, controlHost+"/apps/"+key+"/secret/APP_SECRET?"+q.Encode(), strings.NewReader(value))
	if err != nil {
		return err
	}
	fmt.Println(res)
	return nil
}

func capitalise(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
