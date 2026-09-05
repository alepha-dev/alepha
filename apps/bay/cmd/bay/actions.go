package main

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/alepha/bay/internal/connector"
)

/*
actionKind is the vocabulary Lore may speak to this machine, and it is closed.

This enum is the security boundary of the whole connector. Folio #64 killed
the first design because "a control channel to a VPS is root-equivalent";
that was about an inbound API exposing the CLI surface. Bay dialing out and
Lore pushing over that connection is a different thing only as long as the
capability ceiling is this set, not the channel: every action is a named
variant with typed fields, no action takes a free-form path, a shell command
or an argument list, and a name that is not here is refused and reported,
never passed through to anything.

`deploy` is already code execution as the app user, so the vocabulary bounds
the blast radius without making it small. It does bound it: a compromised
Lore can restart or redeploy the apps this machine already hosts, from
artifacts it already accepts, and can do nothing else here.

Adding a variant is a decision about what a remote party may make this host
do. It belongs in this file, beside this comment, and nowhere else.
*/
type actionKind string

const (
	// actionRestart stops and starts one instance this Bay already runs,
	// exactly the sequence `bay env set` uses when a value changes.
	actionRestart actionKind = "restart"
	// actionDeploy fetches an artifact by digest and hands it to the deploy
	// path every other deploy goes through (#1622).
	actionDeploy actionKind = "deploy"
)

/*
actions is the executor behind the connection: what runs when Lore pushes a
command, and what is said back.

One action at a time on the whole machine, like a deploy: two concurrent
restarts of two apps would be fine, two of the same app would race for the
supervisor, and the serialisation is cheaper than telling them apart. Lore
holds the queue and redelivers, so nothing is lost by waiting.

Every action is idempotent by id through `connector.Outcomes`: a redelivered
id that already finished is re-acked from what was stored, never re-run.
*/
type actions struct {
	s        *server
	outcomes *connector.Outcomes
	mu       sync.Mutex

	welcomeMu sync.Mutex
	welcome   connector.Welcome
}

func newActions(s *server) *actions {
	outcomes, err := connector.OpenOutcomes(s.root)
	if err != nil {
		// Reported and started over: the cost of forgetting is one redelivered
		// action running again, the cost of refusing is a machine off the air.
		s.log.Warn("connector outcomes unreadable, starting empty", "err", err)
	}
	return &actions{s: s, outcomes: outcomes}
}

// Welcome keeps the latest switches Lore sent, for the actions that consult
// them (a deploy refuses itself while deployAllowed is off, #1622).
func (a *actions) Welcome(w connector.Welcome) {
	a.welcomeMu.Lock()
	a.welcome = w
	a.welcomeMu.Unlock()
}

func (a *actions) latestWelcome() connector.Welcome {
	a.welcomeMu.Lock()
	defer a.welcomeMu.Unlock()
	return a.welcome
}

// Command runs one pushed command and acknowledges it.
//
// `running` is sent on pickup so Lore can tell a slow restart from a dead
// machine, then the terminal ack the moment the action finishes. A refusal
// decided before anything moves (an unknown kind) is acked terminal at once:
// there is nothing running to report.
func (a *actions) Command(ctx context.Context, cmd connector.Command, send func(connector.Ack) error) {
	log := a.s.log.With("command", cmd.ID, "kind", cmd.Kind, "app", cmd.App+"/"+cmd.Environment)

	if prior, ok := a.outcomes.Get(cmd.ID); ok {
		// Redelivered after a lost ack: say again what happened, run nothing.
		log.Info("lore command redelivered, re-acking the stored outcome", "status", prior.Status)
		_ = send(connector.NewAck(cmd.ID, prior.Status, prior.Step, prior.Reason))
		return
	}

	switch actionKind(cmd.Kind) {
	case actionRestart, actionDeploy:
	default:
		// Refused and reported, never executed or passed through. The reason
		// names the vocabulary so the other side learns what this Bay speaks.
		reason := fmt.Sprintf("unknown action %q: this bay runs %s and %s, nothing else",
			cmd.Kind, actionRestart, actionDeploy)
		log.Warn("lore command refused", "reason", reason)
		a.finish(cmd.ID, "failed", "", reason, send)
		return
	}

	if !a.outcomes.Begin(cmd.ID) {
		// Still running from an earlier delivery: it acks when it finishes.
		log.Info("lore command redelivered while still running")
		return
	}
	if err := send(connector.NewAck(cmd.ID, "running", "", "")); err != nil {
		log.Debug("could not ack running", "err", err)
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	log.Info("lore command started")
	var status, step, reason string
	switch actionKind(cmd.Kind) {
	case actionRestart:
		status, step, reason = a.restart(cmd)
	case actionDeploy:
		status, step, reason = a.deploy(ctx, cmd)
	}
	if status == "done" {
		log.Info("lore command done")
	} else {
		log.Warn("lore command failed", "step", step, "reason", reason)
	}
	a.finish(cmd.ID, status, step, reason, send)
}

// finish records the terminal outcome, then acks it. Recorded first: an ack
// that cannot be sent is re-sent from the store on the next delivery, and
// an outcome that was not stored would be run again instead.
func (a *actions) finish(id, status, step, reason string, send func(connector.Ack) error) {
	out, err := a.outcomes.Finish(id, status, step, reason, time.Now())
	if err != nil {
		a.s.log.Warn("could not persist a command outcome", "command", id, "err", err)
	}
	if err := send(connector.NewAck(id, out.Status, out.Step, out.Reason)); err != nil {
		a.s.log.Info("lore command outcome stored, ack deferred to the next delivery",
			"command", id, "err", err)
	}
}

/*
restart is `bay env set`'s own sequence, in-process, on the instance the
command names: hold requests, stop, start.

Refused with a reason rather than done loosely: an instance this Bay does not
have, a static site (no process to restart) and an app somebody stopped on
purpose are all reported failures. That last one matters most: whoever
stopped the app owns that decision, and a restart pushed from a dashboard is
not the command that reverses it.
*/
func (a *actions) restart(cmd connector.Command) (status, step, reason string) {
	key := cmd.App + "/" + cmd.Environment
	app, ok := a.s.store.Get(key)
	if !ok {
		return "failed", "", "unknown instance " + key + " on this bay"
	}
	if app.Static {
		return "failed", "", key + " is a static site: it has no process to restart"
	}
	if !a.s.runner.Running(key) {
		return "failed", "", key + " is not running; it was stopped on this host, and a restart does not reverse that"
	}

	// Requests wait rather than 502, the same way they do through a deploy.
	release := a.s.holdDuring(key)
	defer release()
	if err := a.s.runner.Stop(key, stopGrace); err != nil {
		return "failed", "stop", "the app would not stop, so it is still running the old process: " + err.Error()
	}
	if err := a.s.start(app); err != nil {
		return "failed", "start", "the app did not come back up: " + err.Error()
	}
	return "done", "", ""
}

// deploy is #1622. Until it lands, a deploy command is a reported failure,
// so the wire contract is exercisable end to end and nothing is silently
// dropped.
func (a *actions) deploy(_ context.Context, cmd connector.Command) (status, step, reason string) {
	_ = cmd
	return "failed", "", "deploy is not available in this bay build yet"
}
