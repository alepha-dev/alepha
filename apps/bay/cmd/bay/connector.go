package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/alepha/bay/internal/connector"
	"github.com/alepha/bay/internal/deploy"
)

// reportInterval is how often a connected machine reports.
//
// A minute, which is the resolution at which a restart is still legible.
// Finer buys detail nobody reads and costs the sink a row it will overwrite;
// coarser turns "it went down and came back" into a gap.
const reportInterval = time.Minute

// cmdConnector runs on the machine, editing the file directly.
//
// Deliberately NOT a client of the control API. The connector list is not
// something Bay serves — it is how this host was told where to report, and
// wiring it through the root-equivalent socket would mean an app granted
// control-API access could redirect the machine's own telemetry.
func cmdConnector(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: bay connector add <op_token> [--sink URL] [--label NAME] | list | remove <prefix>")
	}
	store := connector.NewStore(connectorRoot(args))
	switch args[0] {
	case "add":
		return connectorAdd(store, args[1:])
	case "list":
		return connectorList(store)
	case "remove", "rm":
		if len(args) < 2 {
			return errors.New("usage: bay connector remove <prefix>")
		}
		removed, err := store.Remove(args[1])
		if err != nil {
			return err
		}
		fmt.Printf("removed %s (%s)\n", removed.Prefix(), removed.Sink)
		return nil
	default:
		return fmt.Errorf("unknown connector command %q", args[0])
	}
}

// defaultSink is where a token goes when nobody said otherwise.
//
// A default because the overwhelmingly common case is one Lore, and making
// every operator type its URL is a chance to typo it into a machine that
// silently reports nowhere.
const defaultSink = "https://lore.alepha.dev"

func connectorAdd(store *connector.Store, args []string) error {
	if len(args) == 0 {
		return errors.New("usage: bay connector add <op_token> [--sink URL] [--label NAME]")
	}
	entry := connector.Connector{Token: args[0], Sink: defaultSink}
	for i, arg := range args {
		if i >= len(args)-1 {
			continue
		}
		switch arg {
		case "--sink":
			entry.Sink = args[i+1]
		case "--label":
			entry.Label = args[i+1]
		}
	}
	if err := store.Add(entry); err != nil {
		return err
	}
	fmt.Printf("connector %s added → %s\n", entry.Prefix(), entry.Sink)
	fmt.Println("It reports within a minute of `bay serve` running. `bay connector list` to check.")
	return nil
}

func connectorList(store *connector.Store) error {
	entries, err := store.List()
	if err != nil {
		return err
	}
	if len(entries) == 0 {
		// Said in words: an empty list and a missing file mean the same thing,
		// and "this Bay reports to nobody" is a normal state worth stating
		// rather than an empty screen to interpret.
		fmt.Println("no connectors — this Bay reports to nobody")
		return nil
	}
	for _, e := range entries {
		fmt.Printf("%-14s %s", e.Prefix(), e.Sink)
		if e.Label != "" {
			fmt.Printf("  (%s)", e.Label)
		}
		fmt.Println()
	}
	return nil
}

// connectorRoot resolves --root the same way `serve` does, because the file
// lives beside the state it describes.
func connectorRoot(args []string) string {
	root := defaultRoot
	if env := os.Getenv("BAY_ROOT"); env != "" {
		root = env
	}
	for i, arg := range args {
		if arg == "--root" && i < len(args)-1 {
			root = args[i+1]
		}
	}
	return root
}

// reportLoop pushes this machine's world to every configured sink.
//
// Started unconditionally: the list is read on every tick rather than at boot,
// so `bay connector add` takes effect within a minute without restarting the
// proxy — and restarting the proxy restarts every hosted app, which is far too
// much to pay for enrolling a machine.
func (s *server) reportLoop(ctx context.Context) {
	store := connector.NewStore(s.root)
	client := &http.Client{}
	ticker := time.NewTicker(reportInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			entries, err := store.List()
			if err != nil {
				s.log.Warn("could not read connectors", "err", err)
				continue
			}
			if len(entries) == 0 {
				continue
			}
			report := s.buildReport()
			for _, entry := range entries {
				if err := connector.Push(ctx, client, entry, report); err != nil {
					// Warn, not error, and swallowed: a sink being briefly
					// unreachable is a gap in someone's dashboard, not an
					// incident on this host. Letting it through would put a
					// stack trace in the log every minute of an outage
					// somewhere else.
					s.log.Warn("outpost report failed", "sink", entry.Sink, "err", err)
				}
			}
		}
	}
}

// buildReport assembles what this machine currently knows.
//
// Everything comes from state already kept for other reasons — the registry,
// the supervisor, and the release directories on disk. Nothing is recorded
// specially for reporting, which is why a Bay that has never reported can be
// enrolled and immediately hand over its whole deploy history.
func (s *server) buildReport() connector.Report {
	report := connector.Report{
		Agent:      "bay " + version,
		BaseDomain: s.store.BaseDomain(),
	}
	for _, app := range s.store.Apps() {
		entry := connector.ReportApp{
			App:           app.Name,
			Environment:   app.Env,
			Domains:       app.Domains,
			Release:       app.Release,
			Running:       s.runner.Running(app.Key()),
			LastRequestAt: app.LastRequestAt,
		}
		if usage, ok := s.runner.Usage(app.Key()); ok {
			entry.MemoryBytes = usage.MemoryBytes
			entry.Restarts = usage.Restarts
		}
		report.Apps = append(report.Apps, entry)

		releases, err := deploy.Releases(filepath.Join(s.root, "apps", app.Name, app.Env))
		if err != nil {
			// An instance whose releases cannot be listed still belongs in the
			// report — its state is what the operator is watching. Only its
			// history is missing, and saying nothing about it would be worse.
			continue
		}
		report.Events = append(report.Events,
			connector.DeployEvents(app.Name, app.Env, releases)...)
	}
	if report.Apps == nil {
		// An explicit empty list rather than null: the sink treats "apps" as the
		// whole truth and deletes what is absent, so a machine hosting nothing
		// has to be able to say exactly that.
		report.Apps = []connector.ReportApp{}
	}
	return report
}
