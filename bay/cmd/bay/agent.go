package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/alepha-dev/bay/internal/connector"
	"github.com/alepha-dev/bay/internal/state"
)

/*
cmdAgent runs Bay as a monitor only (#Q4002): the Lore connection and the host
gauge, and nothing else.

It is for a machine Bay does not run apps on, reached as a plain user: the
operator wants Lore's host page (memory, disk, load) and nothing that can
change the machine. So, where `serve` binds the proxy, may start ACME on 80
and 443, opens the control socket and needs Docker, `agent` does none of it:

  - no listener at all, public or local: it only dials out to Lore;
  - no Docker, no root: its state is a directory the user owns, by default
    under their home;
  - every command Lore sends is refused here, on the machine, whatever its
    kind, and the inventory says `mode: monitor` so Lore shows the host as
    monitor-only and offers it no action.

Enrol it with `bay connector set --root <the same root> <lore> <secret>`, run
before or while it runs: the client re-reads the connector file on every
dial, so a running agent picks the secret up at its next attempt.
*/
func cmdAgent(args []string) error {
	if err := checkFlags(args, nil, map[string]bool{"--root": true}); err != nil {
		return err
	}
	root, _ := resolveRoot(args, agentDefaultRoot())
	root, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return fmt.Errorf("create %s: %w", root, err)
	}
	// An empty state.json is what makes the directory a Bay root, so the
	// `bay connector set --root` an operator runs next accepts it.
	if _, err := state.Open(filepath.Join(root, "state.json")); err != nil {
		return err
	}

	log := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	log.Info("bay agent: monitor only, no listener, no deploys", "root", root, "version", version)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	newAgentClient(root, log).Run(ctx)
	return nil
}

// agentDefaultRoot is where an agent keeps its state when nothing names one:
// the installer's root for root, the user's own state directory otherwise,
// since the whole point is a machine where the support account is not root.
func agentDefaultRoot() string {
	if os.Geteuid() == 0 {
		return installerRoot
	}
	if dir := os.Getenv("XDG_STATE_HOME"); dir != "" {
		return filepath.Join(dir, "bay")
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, ".local", "state", "bay")
	}
	return defaultRoot
}

// newAgentClient is the connection an agent runs: the host gauge and the
// monitor-only handler.
func newAgentClient(root string, log *slog.Logger) *connector.Client {
	return &connector.Client{
		Store:   connector.NewStore(root),
		Status:  connector.NewStatus(),
		Log:     log,
		Handler: monitorHandler{log: log},
		Gauge:   connector.HostGauge(root),
		// A monitor reports what happened as well as what is: a watched unit
		// that failed at 3am is an event, spooled until Lore takes it.
		Events:  connector.NewEventSpool(root, 0),
		Units:   connector.SystemctlUnits,
		Version: version,
		Mode:    connector.ModeMonitor,
		// An agent is upgraded on the machine, never by a command.
		UpgradeMode: "manual",
	}
}

/*
monitorHandler is the executor of a monitor-only Bay: it runs nothing.

Every command is acknowledged `failed` at once with the reason, whatever its
kind, including the ones this build does not know: the refusal is decided
here, machine-side, so a Lore that sends a deploy anyway (a bug, an old Lore,
a stolen sink) still changes nothing.
*/
type monitorHandler struct {
	log *slog.Logger
}

func (monitorHandler) Welcome(connector.Welcome) {}

func (h monitorHandler) Command(_ context.Context, cmd connector.Command, send func(connector.Ack) error) {
	reason := fmt.Sprintf("this bay is monitor-only (bay agent): it runs no command, %q refused", cmd.Kind)
	h.log.Warn("lore command refused", "command", cmd.ID, "kind", cmd.Kind, "reason", reason)
	_ = send(connector.NewAck(cmd.ID, "failed", "", reason))
}

// Inventory is the host alone: no app, no stack. The client stamps the host
// block from the gauge and the mode.
func (monitorHandler) Inventory(context.Context) (connector.Inventory, bool) {
	return connector.Inventory{Apps: []connector.InventoryApp{}}, true
}
