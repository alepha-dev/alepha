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

// commandInterval is how often a machine asks whether there is work.
//
// Five seconds, not the report's minute: this is the only thing standing
// between `platform up` finishing and a human waiting on it. The request has an
// empty body and the answer is 204 in the overwhelming majority of cases, so
// the cost is a request rather than a payload.
//
// It is a poll rather than a held connection for one reason, and it is not a
// preference: on Workers the deploying client's request and the connection this
// would hold land in different isolates, and nothing addresses one from the
// other without Durable Objects. When Lore moves onto Bay this becomes a held
// connection and the interval goes away — the contract above it does not
// change.
const commandInterval = 5 * time.Second

// commandLoop asks every configured sink for work, and does it.
//
// Started alongside reportLoop and reading the same file on every tick, so
// `bay connector add` takes effect within seconds without restarting the proxy
// — and restarting the proxy restarts every hosted app.
func (s *server) commandLoop(ctx context.Context) {
	store := connector.NewStore(s.root)
	client := &http.Client{}
	ticker := time.NewTicker(commandInterval)
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
			for _, entry := range entries {
				cmd, err := connector.Poll(ctx, client, entry)
				if err != nil {
					// Debug, not warn: unlike a report, a failed poll loses
					// nothing — the next one is five seconds away with the same
					// question. At this cadence a warn would put twelve lines a
					// minute in the journal for an outage somewhere else.
					s.log.Debug("command poll failed", "sink", entry.Sink, "err", err)
					continue
				}
				if cmd == nil {
					continue
				}
				s.runDeployCommand(ctx, client, entry, *cmd)
			}
		}
	}
}

// runDeployCommand executes one release and narrates it back.
//
// Serialised across the whole machine by `deployMu`: two concurrent deploys
// would race for `state.json` and for each other's systemd units. A mutex
// rather than a queue, because the sink already holds the queue — a release
// this machine does not pick up now is still claimable on the next poll.
func (s *server) runDeployCommand(ctx context.Context, client *http.Client, entry connector.Connector, cmd connector.DeployCommand) {
	s.deployMu.Lock()
	defer s.deployMu.Unlock()

	log := s.log.With("app", cmd.App+"/"+cmd.Environment, "release", cmd.Version)
	log.Info("deploy claimed from sink", "sink", entry.Sink)

	// Every failure below reports `failed` before returning. Swallowing one
	// would leave whoever is waiting on this release stuck until their own
	// timeout, with no reason — which is the most expensive way this system can
	// break, and the least visible.
	fail := func(stage string, err error) {
		log.Error("deploy failed", "stage", stage, "err", err)
		if rerr := connector.ReportStatus(ctx, client, entry, cmd.ReleaseID, "failed",
			stage+": "+err.Error()); rerr != nil {
			s.log.Error("could not report the failure either", "err", rerr)
		}
	}

	report := func(status string) bool {
		if err := connector.ReportStatus(ctx, client, entry, cmd.ReleaseID, status, ""); err != nil {
			// Abandoned rather than pressed on with: if the sink will not take
			// a transition, it is not going to take the outcome either, and
			// deploying anyway would change the host while the registry still
			// believes nothing happened.
			log.Error("could not report a transition, abandoning", "status", status, "err", err)
			return false
		}
		return true
	}

	if !report("pulling") {
		return
	}

	artifact := filepath.Join(os.TempDir(), "bay-release-"+cmd.ReleaseID+".tar.gz")
	if err := connector.Fetch(ctx, client, cmd.DownloadURL, entry.Token, cmd.SHA256, artifact); err != nil {
		fail("pull", err)
		return
	}
	defer os.Remove(artifact)

	if !report("migrating") {
		return
	}

	out, derr := s.deployArtifact(ctx, deployArtifactOptions{
		Artifact: artifact, Name: cmd.App, Env: cmd.Environment,
		// No domains and no control API from this path. Both are operator
		// decisions that live in `state.json`: an existing app keeps what it
		// was deployed with, and granting root-equivalent access on the say-so
		// of a remote payload is exactly the door this design closed.
	})
	if derr != nil {
		fail("deploy", derr)
		return
	}

	if !report("serving") {
		return
	}
	log.Info("deploy served", "release", out.Result.Release)
}
