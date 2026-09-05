package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/alepha/bay/internal/connector"
)

/*
cmdConnector enrols this machine as an estate of a Lore instance, or shows and
forgets that enrolment.

	bay connector set <lore-url> <secret>
	bay connector show
	bay connector clear

It edits the file directly, beside state.json, and is deliberately NOT a
client of the control API for the credential itself: the socket is
root-equivalent and reachable by the control group, and routing the secret
through it would let anyone in that group point the machine's own telemetry
and command channel at another server. The socket carries one thing about the
connector, "re-read the file", and one question, "is the connection up".
*/
func cmdConnector(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: bay connector (set <lore-url> <secret> | show | clear) [--root DIR]")
	}
	if err := checkFlags(args[1:], map[string]bool{},
		map[string]bool{"--root": true, "--control-socket": true}); err != nil {
		return err
	}
	root, err := connectorRoot(args[1:])
	if err != nil {
		return err
	}
	store := connector.NewStore(root)
	switch args[0] {
	case "set":
		return connectorSet(store, positionals(args[1:]), os.Stdout)
	case "show":
		return connectorShow(store, os.Stdout)
	case "clear":
		return connectorClear(store, os.Stdout)
	default:
		return fmt.Errorf("unknown connector command %q (set, show, clear)", args[0])
	}
}

// positionals drops `--flag VALUE` pairs and returns what is left, in order.
func positionals(args []string) []string {
	var out []string
	for i := 0; i < len(args); i++ {
		if len(args[i]) > 2 && args[i][:2] == "--" {
			i++
			continue
		}
		out = append(out, args[i])
	}
	return out
}

func connectorSet(store *connector.Store, args []string, out io.Writer) error {
	if len(args) != 2 {
		return errors.New("usage: bay connector set <lore-url> <secret>")
	}
	if err := store.Set(connector.Config{Sink: args[0], Secret: args[1]}); err != nil {
		return err
	}
	cfg, _, err := store.Load()
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "connector set → %s (%s)\n", cfg.Sink, connector.SocketURL(cfg.Sink))
	fmt.Fprintln(out, "The secret is stored at", store.Path(), "with mode 0600 and is never printed again.")
	pokeConnectorReload(out)
	return nil
}

func connectorClear(store *connector.Store, out io.Writer) error {
	if err := store.Clear(); err != nil {
		return err
	}
	// Said in words: a missing file and a cleared one mean the same thing,
	// and "this Bay dials nobody" is a normal state worth stating.
	fmt.Fprintln(out, "connector cleared — this Bay dials nobody")
	pokeConnectorReload(out)
	return nil
}

/*
connectorShow prints the sink, the estate, and whether the connection is up.

Never the secret, not even a prefix. The secret is stored hashed on the Lore
side and cleartext here because it has to be presented on every dial; echoing
any of it into a terminal is a copy in a scrollback buffer, a screen recording
and a support paste.

Three sources, because they live in three places: the sink is the file, the
slug is the cached welcome (Lore names the estate; the secret does not), and
"is it up" is asked of the running server over the control socket, the way
`bay status` asks everything else. A status file would lie after a crash, so
when no server answers the answer is that no server answers.
*/
func connectorShow(store *connector.Store, out io.Writer) error {
	cfg, ok, err := store.Load()
	if err != nil {
		return err
	}
	if !ok {
		fmt.Fprintln(out, "no connector configured — this Bay dials nobody")
		fmt.Fprintln(out, "Enrol it with: bay connector set <lore-url> <secret>")
		return nil
	}
	fmt.Fprintf(out, "sink:        %s\n", cfg.Sink)
	fmt.Fprintf(out, "endpoint:    %s\n", connector.SocketURL(cfg.Sink))
	if welcome, ok, err := store.LoadWelcome(); err == nil && ok {
		fmt.Fprintf(out, "estate:      %s\n", welcome.Slug)
		mode := "stats only"
		if welcome.DeployAllowed {
			mode = "deploys allowed"
		}
		fmt.Fprintf(out, "switches:    %s, stats every %ds\n", mode, welcome.StatsIntervalSeconds)
	} else {
		fmt.Fprintln(out, "estate:      not yet connected")
	}

	raw, err := call(http.MethodGet, controlHost+"/connector", nil)
	if err != nil {
		fmt.Fprintln(out, "connection:  bay serve is not running")
		return nil
	}
	var report connectorReport
	if err := json.Unmarshal([]byte(raw), &report); err != nil {
		return fmt.Errorf("parse control api response: %w", err)
	}
	switch {
	case report.Connected:
		fmt.Fprintf(out, "connection:  up since %s\n", report.Since)
	case report.LastError != "":
		fmt.Fprintf(out, "connection:  down (%s)\n", report.LastError)
	default:
		fmt.Fprintln(out, "connection:  down")
	}
	return nil
}

// pokeConnectorReload tells a running `bay serve` to re-read the file.
//
// Best effort and silent on failure beyond one line: the server also re-reads
// the file before every dial, so a missed poke costs one backoff step rather
// than a restart, and restarting the proxy restarts every hosted app.
func pokeConnectorReload(out io.Writer) {
	if _, err := call(http.MethodPost, controlHost+"/connector/reload", nil); err != nil {
		fmt.Fprintln(out, "bay serve is not running here; it reads the connector when it starts")
		return
	}
	fmt.Fprintln(out, "bay serve has been told; it takes effect without a restart")
}

/*
connectorRoot resolves --root the way `serve` does, because the file lives
beside the state it describes.

It REFUSES a directory that no Bay serves from, instead of writing there. The
default root is relative (`./bay-data`), so before this check a `connector set`
run from a home directory, which is where an operator ssh-es into, created a
fresh tree, wrote the secret into it and printed success. Nothing read that
file: the running Bay was rooted elsewhere, and on a host installed under /opt
the two are never the same. `show` then resolved the same wrong path and
confirmed the secret was there, so the check an operator would naturally run
agreed with the mistake instead of catching it.

`state.json` is the marker because it is the file `serve` opens; asking the
same question the server asks is what keeps the two from drifting apart.
*/
func connectorRoot(args []string) (string, error) {
	root := defaultRoot
	source := "the default root"
	if env := os.Getenv("BAY_ROOT"); env != "" {
		root, source = env, "$BAY_ROOT"
	}
	for i, arg := range args {
		if arg == "--root" && i < len(args)-1 {
			root, source = args[i+1], "--root"
		}
	}
	// Reported as an absolute path: "./bay-data" tells an operator nothing about
	// which directory it landed in, and the whole failure was about being
	// somewhere unexpected.
	shown := root
	if abs, err := filepath.Abs(root); err == nil {
		shown = abs
	}
	if _, err := os.Stat(filepath.Join(root, "state.json")); err != nil {
		return "", fmt.Errorf(
			"%s is not a Bay root: no state.json in %s (from %s). "+
				"Pass --root or set $BAY_ROOT to the directory `bay serve` runs from "+
				"(commonly /opt/bay/data), or run `bay serve` first if this machine is new",
			shown, shown, source)
	}
	return root, nil
}

/*
connectorLoop runs the Lore connection for the life of `serve`.

What Lore pushes is run by `actions`, the closed vocabulary in actions.go.
*/
func (s *server) connectorLoop(ctx context.Context) {
	client := &connector.Client{
		Store:   connector.NewStore(s.root),
		Status:  s.connectorStatus,
		Log:     s.log,
		Reload:  s.connectorReload,
		Handler: newActions(s),
		Gauge:   connector.HostGauge(),
	}
	client.Run(ctx)
}

// ---------------------------------------------------------------------------
// control API
// ---------------------------------------------------------------------------

// connectorReport is what `GET /connector` answers: whether a sink is
// configured and which, the estate Lore named, and the live connection state.
// Never the secret: the socket never carries a sink to set or a secret at all.
type connectorReport struct {
	Configured bool   `json:"configured"`
	Sink       string `json:"sink,omitempty"`
	Slug       string `json:"slug,omitempty"`
	connector.Snapshot
}

func (s *server) registerConnectorRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /connector", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, s.connectorReport())
	})
	// "Re-read the file", and nothing else: the body is ignored on purpose.
	mux.HandleFunc("POST /connector/reload", func(w http.ResponseWriter, _ *http.Request) {
		s.pokeConnectorReload()
		writeJSON(w, http.StatusOK, map[string]string{"reload": "requested"})
	})
}

func (s *server) connectorReport() connectorReport {
	store := connector.NewStore(s.root)
	report := connectorReport{Snapshot: s.connectorStatus.Snapshot()}
	if cfg, ok, err := store.Load(); err == nil && ok {
		report.Configured = true
		report.Sink = cfg.Sink
	}
	if welcome, ok, err := store.LoadWelcome(); err == nil && ok {
		report.Slug = welcome.Slug
	}
	return report
}

// pokeConnectorReload wakes the dial loop, if `serve` has one.
//
// Non-blocking: a poke while one is already pending is the same instruction
// twice, and the CLI paths that never serve have no loop to wake.
func (s *server) pokeConnectorReload() {
	if s.connectorReload == nil {
		return
	}
	select {
	case s.connectorReload <- struct{}{}:
	default:
	}
}
