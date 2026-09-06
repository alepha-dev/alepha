package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
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
	// actionStop takes one instance out of service, durably: the intent is
	// persisted and the unit is disabled, so a reboot and a Bay upgrade both
	// leave it down. The way back is `start` or a deploy.
	//
	// ⚠️ The first verb here that can make a live site go dark from a click in
	// a browser. Everything else in this vocabulary either replaces a running
	// app with another running app, or asks a question.
	actionStop actionKind = "stop"
	// actionStart puts a stopped instance back, and is the way back from
	// `stop`: `restart` deliberately refuses an app nobody is running.
	actionStart actionKind = "start"
	// actionBackup takes the same snapshot `bay backup` takes: the database
	// Bay provisioned, and nothing else.
	actionBackup actionKind = "backup"
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

	// kick asks the connection to push a fresh inventory. Wired by
	// connectorLoop to the client that owns the socket, and nil everywhere
	// else — a CLI path with no connection has nothing to tell.
	kick func()
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
	case actionRestart, actionDeploy, actionStop, actionStart, actionBackup:
	default:
		// Refused and reported, never executed or passed through. The reason
		// names the vocabulary so the other side learns what this Bay speaks.
		reason := fmt.Sprintf("unknown action %q: this bay runs %s, %s, %s, %s and %s, nothing else",
			cmd.Kind, actionRestart, actionDeploy, actionStop, actionStart, actionBackup)
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

	log.Info("lore command started")
	var status, step, reason string
	if actionKind(cmd.Kind) == actionBackup {
		// Outside the machine-wide mutex, deliberately. A snapshot, a verify
		// and an upload is minutes on a real database, and holding that lock
		// for it would queue an unrelated app's restart behind a backup.
		// `backupInstance` takes a per-instance lock the scheduler shares,
		// which is the overlap that actually matters.
		status, step, reason = a.backup(ctx, cmd)
	} else {
		status, step, reason = a.runExclusive(ctx, cmd, send)
	}
	if status == "done" {
		log.Info("lore command done")
	} else {
		log.Warn("lore command failed", "step", step, "reason", reason)
	}
	a.finish(cmd.ID, status, step, reason, send)
}

/*
runExclusive runs one action with the machine-wide mutex held, and releases it
before anything is acked or pushed.

A function of its own so the unlock is a `defer` rather than a line somebody
has to remember after every return: an action that panics must still release
the machine. It also puts the ack and the inventory push OUTSIDE the mutex,
which matters because that mutex serialises every action on this host — pushing
an inventory while holding it would turn each push into a lock on the deploy
path.
*/
func (a *actions) runExclusive(ctx context.Context, cmd connector.Command, send func(connector.Ack) error) (status, step, reason string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	switch actionKind(cmd.Kind) {
	case actionRestart:
		return a.restart(cmd)
	case actionDeploy:
		return a.deploy(ctx, cmd, send)
	case actionStop:
		return a.stop(cmd)
	case actionStart:
		return a.start(cmd)
	}
	// Unreachable: Command refuses an unknown kind before it ever takes the
	// lock. Said out loud rather than left as three empty strings, which would
	// ack `done` for an action nobody ran.
	return "failed", "", "this bay does not know how to run " + cmd.Kind
}

/*
finish records the terminal outcome, acks it, and asks for a fresh inventory.

Recorded first: an ack that cannot be sent is re-sent from the store on the
next delivery, and an outcome that was not stored would be run again instead.

The kick is last and is not part of the outcome. Every action that reaches here
may have changed what the console shows — a restart moves the uptime, a deploy
moves the release, a backup moves lastBackupAt — and the alternative is a page
that shows the old state for up to half an hour after the click that changed it.
*/
func (a *actions) finish(id, status, step, reason string, send func(connector.Ack) error) {
	out, err := a.outcomes.Finish(id, status, step, reason, time.Now())
	if err != nil {
		a.s.log.Warn("could not persist a command outcome", "command", id, "err", err)
	}
	if err := send(connector.NewAck(id, out.Status, out.Step, out.Reason)); err != nil {
		a.s.log.Info("lore command outcome stored, ack deferred to the next delivery",
			"command", id, "err", err)
	}
	if a.kick != nil {
		a.kick()
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
		return "failed", "", key + " is not running; it was stopped on this host, and a restart does not reverse that — start it instead"
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

/*
stop takes the instance out of service, durably.

Through `stopInstance`, the same helper `bay stop` and the control route go
through, so the CLI, the socket and Lore cannot end up meaning three different
things by one word.

Stopping an already-stopped instance SUCCEEDS. `systemctl disable --now` exits
0 on an inactive unit and the child runner returns nil when nothing is running,
so the effect is idempotent for free - and a console that reported a failure
for reaching the state it asked for would be wrong about what it did.
*/
func (a *actions) stop(cmd connector.Command) (status, step, reason string) {
	if err := a.s.stopInstance(cmd.App + "/" + cmd.Environment); err != nil {
		return "failed", "", err.Error()
	}
	return "done", "", ""
}

/*
start puts a stopped instance back.

⚠️ An instance that is already running is answered `done` without being
touched. `Systemd.Start` runs `systemctl restart`, so starting a healthy app
would bounce production in disguise; `startInstance` carries that rule.
*/
func (a *actions) start(cmd connector.Command) (status, step, reason string) {
	if err := a.s.startInstance(cmd.App + "/" + cmd.Environment); err != nil {
		return "failed", "", err.Error()
	}
	return "done", "", ""
}

/*
backup takes the same snapshot `bay backup` takes, through the same function.

⚠️ The success reason says DATABASE, in words, and lists what is not covered.
Bay's README is emphatic about why: a backup covers the database and nothing
else, `storage/` and `.env` are never archived, and the worst failure of a
backup system is somebody believing it covers more than it does. A console
that said "backed up" and left it there would be manufacturing that belief.

A refusal (a static site, an app on a BYO database, no bucket configured) is a
`failed` ack with the reason, and records NO backup failure on the instance:
that field is for attempts, and a permanent wrong warning is how people learn
to ignore warnings.
*/
func (a *actions) backup(ctx context.Context, cmd connector.Command) (status, step, reason string) {
	key := cmd.App + "/" + cmd.Environment
	app, ok := a.s.store.Get(key)
	if !ok {
		return "failed", "", "unknown instance " + key + " on this bay"
	}
	out, err := a.s.backupInstance(ctx, app)
	if err != nil {
		return "failed", "", err.Error()
	}
	return "done", "", fmt.Sprintf("database snapshot stored as %s (%d bytes); NOT covered: %s",
		out.Result.Key, out.Result.StoredBytes, strings.Join(out.NotBackedUp, "; "))
}

/*
deploy pulls the artifact the command names, verifies it, and hands it to the
deploy path every other deploy goes through.

Bay does not build and does not choose. The command names one artifact by
digest, there is no "latest" on this side, and the bytes and the secret set
are pulled from the sink by this command's id under the estate secret. Three
digests must agree before anything is unpacked (the command's, the sink's
header, the bytes as they arrive); a mismatch is a reported failure that
leaves nothing on disk; and an artifact already held at that digest is not
downloaded again, which is what makes a redeploy and a rollback cheap.

The estate's deploy switch is honoured here too, from the welcome frame and
before any fetch. Lore refuses at enqueue, and a Lore-side bug must still not
turn a stats-only machine into a deploy target.

A deploy is the one action with a progress story: `running` with the step as
each begins, then the terminal outcome. Secrets reach the instance env the way
`bay deploy --secrets-file` delivers them and nowhere else: never a log line,
never an ack.
*/
func (a *actions) deploy(ctx context.Context, cmd connector.Command, send func(connector.Ack) error) (status, step, reason string) {
	if !a.latestWelcome().DeployAllowed {
		return "failed", "", "this estate does not accept deploys: its owner has not allowed them, and the welcome frame said so"
	}
	if cmd.Artifact == nil || len(cmd.Artifact.SHA256) != 64 {
		return "failed", "", connector.ErrNoArtifact.Error()
	}
	cfg, ok, err := connector.NewStore(a.s.root).Load()
	if err != nil || !ok {
		return "failed", "", "no connector is configured on this bay, so there is nothing to pull from"
	}
	progress := func(step string) { _ = send(connector.NewAck(cmd.ID, "running", step, "")) }
	client := &http.Client{Timeout: connector.FetchTimeout}

	want := strings.ToLower(cmd.Artifact.SHA256)
	dir := filepath.Join(a.s.root, "artifacts")
	dest := filepath.Join(dir, want+".tar.gz")
	if connector.ArtifactCached(dest, want) {
		a.s.log.Info("artifact already held, skipping the download", "command", cmd.ID, "sha256", want[:12])
	} else {
		step = "downloading"
		progress(step)
		if err := connector.PullArtifact(ctx, client, cfg, cmd.ID, want, dest, func() {
			step = "verifying"
			progress(step)
		}); err != nil {
			return "failed", step, err.Error()
		}
	}

	progress("deploying")
	secrets, err := connector.PullSecrets(ctx, client, cfg, cmd.ID)
	if err != nil {
		return "failed", "deploying", "could not pull the secret set: " + err.Error()
	}
	secretsFile, err := a.writeSecretsFile(secrets)
	if err != nil {
		return "failed", "deploying", err.Error()
	}
	out, derr := a.s.deployArtifact(ctx, deployArtifactOptions{
		Artifact: dest, Name: cmd.App, Env: cmd.Environment, SecretsFile: secretsFile,
	})
	if derr != nil {
		return "failed", "deploying", derr.Error()
	}
	a.s.log.Info("lore deploy served", "command", cmd.ID, "release", out.Result.Release)
	a.pruneArtifacts(dir, keepArtifacts)
	return "done", "", ""
}

// keepArtifacts bounds the local cache under <root>/artifacts: enough for a
// rollback to the last few releases to cost no download, small enough that
// the cache never becomes the thing filling the disk.
const keepArtifacts = 5

/*
writeSecretsFile stages the pulled set the way the deploying user stages
`--secrets-file`: a 0600 regular file under the Bay root, which
`deploy.ConsumeSecretsFile` reads, validates and unlinks on every path out.
Nothing else ever holds the values: not this function's error, not a log.

Values are written literally, one per line, which is what ParseAssignments
reads; a value with a line break cannot be carried that way and is refused by
name rather than mangled.
*/
func (a *actions) writeSecretsFile(secrets map[string]string) (string, error) {
	if len(secrets) == 0 {
		return "", nil
	}
	keys := make([]string, 0, len(secrets))
	for k := range secrets {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		v := secrets[k]
		if strings.ContainsAny(v, "\r\n") {
			return "", fmt.Errorf("secret %s holds a line break, which the instance env cannot carry", k)
		}
		b.WriteString(k)
		b.WriteString("=")
		b.WriteString(v)
		b.WriteString("\n")
	}
	// CreateTemp creates the file 0600, which is the mode ConsumeSecretsFile
	// requires and the only one a secrets file may have.
	f, err := os.CreateTemp(a.s.root, ".deploy-secrets-*")
	if err != nil {
		return "", err
	}
	if _, err := f.WriteString(b.String()); err != nil {
		f.Close()
		os.Remove(f.Name())
		return "", err
	}
	if err := f.Close(); err != nil {
		os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}

// pruneArtifacts keeps the newest `keep` cached artifacts and removes the
// rest. Never fatal: a cache that could not be trimmed is disk used, not a
// deploy that failed.
func (a *actions) pruneArtifacts(dir string, keep int) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	type cached struct {
		name string
		mod  time.Time
	}
	var files []cached
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".tar.gz") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		files = append(files, cached{e.Name(), info.ModTime()})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].mod.After(files[j].mod) })
	for _, f := range files[min(keep, len(files)):] {
		_ = os.Remove(filepath.Join(dir, f.name))
	}
}
