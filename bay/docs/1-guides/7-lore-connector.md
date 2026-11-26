# Lore connector

Enrol a Bay host as a **host** of a Lore instance, so Lore can show what the
machine runs and send it a small, fixed set of commands, without opening any
port on the host.

The connector is optional. A Bay that never enrols is fully operable over SSH,
and an enrolled one still is: the console is a second door, never the only one.

## How it works

```mermaid
sequenceDiagram
  participant Bay as bay serve (host)
  participant Lore
  participant You as Operator (browser)
  Bay->>Lore: dial wss://lore.example.com/ws/estates with the host secret
  Lore-->>Bay: accepted, with the host's name
  Bay->>Lore: inventory: host load, apps, releases, backups, certificates
  You->>Lore: queue "restart myapp/production"
  Lore-->>Bay: command (arrives immediately over the open socket)
  Bay->>Bay: validate the verb, run it
  Bay->>Lore: outcome
```

The machine dials **out** and holds a websocket open, so a command queued in
Lore arrives the instant it is queued. Nothing listens for it: there is no
inbound port, and the secret authenticates the machine to Lore without granting
anything on the host.

## Enrolling

A fresh server installs Bay, starts it under systemd and enrols it in one line,
when `install.sh` is given the Lore URL and the host's secret:

```bash
curl -sSL https://alepha.dev/bay/install.sh \
  | sudo LORE_URL=https://lore.alepha.app LORE_ESTATE_SECRET=est_... sh
```

The installer writes the unit from the installation guide unless one exists,
waits for `bay serve`, runs `bay connector set`, and never prints the secret.
On a host already running Bay:

1. In Lore, create a host in a project with Apps on: from its
   **Settings ▸ Apps ▸ Hosts**, or with `lore host add <slug>`. The
   host belongs to that project. The secret is shown **once**.
2. On the host, as root:

```bash
sudo bay connector set https://lore.example.com est_...
sudo bay connector show
```

`set` stores the Lore URL and the secret at mode `0600` beside Bay's
`state.json`, then tells the running `bay serve` over the control socket to
re-read them: nothing restarts. The connector commands edit that file directly
and the data root is `0700`, so they need root; a member of `bay-control`
cannot run them. On a host installed with `install.sh` and its unit they find
`/opt/bay/data` and `/run/bay/control.sock` on their own; elsewhere pass
`--root` (or `BAY_ROOT`) and `--control-socket` (or `BAY_SOCKET`). Without the
socket `bay serve` is not told, and a host enrolling for the first time dials
nothing until its next restart.

The secret is a command-line argument, so `ps` shows it while `set` runs and the
shell history keeps it: clear that entry.

| Command                        | Effect                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `bay connector set URL SECRET` | enrol, or re-enrol with a rotated secret                                         |
| `bay connector show`           | the Lore URL, the host name and whether the connection is up; never the secret |
| `bay connector clear`          | forget both: the machine dials nobody                                            |

`http://` is accepted for a loopback Lore only, so a secret never crosses a
network in clear.

## What Lore can make the machine do

A **closed vocabulary of nineteen verbs**, each naming one app instance or stack
environment, or, for `upgrade`, the machine's own Bay, or, for `job-run`,
`job-cancel`, `job-message` and `job-workspace-remove`, a one-shot job or its workspace (see [Jobs](#jobs)). `deploy` and `stack-deploy` create what they name, `remove` and
`stack-remove` answer done for one that is already gone, and the others refuse
an instance this Bay does not run:

| Verb            | What it does                                                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `restart`       | blue/green, as a deploy replaces a running app; a Compose service restarts in place. Refused for an app that is not running: use `start`                                                |
| `deploy`        | an artifact named by **digest**, which the machine pulls and verifies before anything touches disk                                                                                      |
| `stop`          | out of service, durably: it stays down through a reboot and a Bay upgrade                                                                                                               |
| `start`         | back into service. A no-op on an app already running, never a restart                                                                                                                   |
| `backup`        | the snapshot the schedule takes, now. Refused for an app with no database Bay owns                                                                                                      |
| `logs`          | a tail, uploaded back to Lore. A read, so it answers during a deploy rather than queueing behind it                                                                                     |
| `stack-deploy`  | a stack bundle named by digest, pulled and verified, then applied as a revision                                                                                                         |
| `backups-list`  | the instance's backups in the bucket, newest first, uploaded back to Lore                                                                                                               |
| `backup-verify` | downloads a backup (the newest by default) and checks it as a restore would, without touching the app                                                                                   |
| `target-probe`  | checks the S3 bucket now and reports whether it answers                                                                                                                                 |
| `backup-policy` | sets or clears the instance's operator backup policy, which wins over the app's and the host's                                                                                          |
| `restore`       | brings a backup back (by key, by time, or from another instance); needs a reason unless it is a dry run                                                                                 |
| `remove`        | unregisters an app and stops serving it, as `bay remove` without `--purge`: its database, uploads and `.env` stay on the machine. Refused for a stack member, which goes with its stack |
| `stack-remove`  | takes a stack environment down and forgets it, as `bay stack destroy` without `--purge`: its volumes, variables and registry credentials stay                                           |
| `job-run`       | runs one one-shot job to its end, its output streamed back to Lore as it happens. See [Jobs](#jobs)                                                                                    |
| `job-cancel`    | stops the running job it names                                                                                                                                                          |
| `job-message`   | writes a member's message to the running job it names, on an agent that reads messages while it runs (Claude Code). Refused for any other                                                |
| `job-workspace-remove` | deletes a project's job workspace, or all of them; refused while a job runs in it |
| `upgrade`       | replaces Bay's own binary with a newer release, named by its version, and hands over to it without closing a port. See [Upgrading Bay](/bay/docs/guides-installation#upgrading-bay)     |

⚠️ **This list is a security boundary, not a menu.** It is all that Lore, or
whoever controls Lore, can ask of this machine. No verb takes a path, a shell
command or an argument list; `logs` carries a line count, a time window and a
pattern, all bounded and validated; `backup-policy` carries a policy checked
like `bay backup config`'s, and `restore` a backup key or a time, the instance
to restore from and a reason. Both are held to the same switch as `deploy`,
and Lore refuses them while the machine is offline rather than queueing them.
`upgrade` is held to that switch as well, and it is the verb that replaces a
binary running as root, so it is told as little as possible: a version, as
`x.y.z`, and nothing else. No address, no path and no checksum come from
Lore; the release is fetched from the repository the installer uses and
checked against its `SHA256SUMS`. **A version older than the one running is
refused**, so a Lore that was taken over cannot put a host back on a release
with a known flaw: going back is the installer, run on the machine. And Bay
takes it only when it can hand its sockets over (under systemd, with the
handoff drop-in), answering with the command to run by hand otherwise.
`remove` and `stack-remove` are held to that switch too, and ⚠️ **neither can
delete data**: there is no purge on the wire. Deleting a copy's data is
`bay remove --purge` or `bay stack destroy --purge`, run on the machine, and it
has to come instead of a removal through Lore, since a machine that has
forgotten the copy no longer knows where its data is.
**Exec into a container is not a verb and
never will be**: it takes SSH.

The secret points the other way. It sits on the host in clear, and it is the
bearer the machine shows Lore when it dials, so whoever holds it can pose as
this machine to Lore, down to pulling the artifacts and secret sets of the
commands queued for it. That includes an app's `APP_SECRET`, which Lore hands
to a deploy whose instance has none, and the copy Lore holds of it, which the
holder can replace: Lore says so on that deploy's log. It sends no command to
the host.

**Deploys are refused until somebody who manages the host allows them** (a
member of its project whose rank grants `host:update`), and
the machine enforces that switch on its own side too. `stack-deploy` is held to
the same switch: it runs containers of the bundle's choosing, so allowing
deploys on a host is trusting Lore with the host. A bundle goes through the
checks of any [compose file](/bay/docs/guides-stacks#the-compose-file), and only
those: no bind mount outside its own directory and no Docker socket, but
`devices`, `cap_add` and `security_opt` pass, and `x-lore.tcp: N` opens public
port N.

Stack members are addressed by the same verbs, as the instance
`<stack>.<service>`. A Lore `stack-deploy` also carries the environment's routes
and base domain, which replace those set with `bay stack route`.

## Jobs

A job is not an app: it runs once, to an exit, under a deadline. The first kind
is an **agent job**: an agent CLI (Claude Code or Gemini CLI) run on a prompt in
a workspace directory, which Lore starts from its own pages. Before the agent
starts, Bay prepares the code the job asks for (its **source**, below). The log
is the agent's raw output and the status its exit code. The agent works in Lore
itself, through Lore's MCP server. The one thing Bay reads from what it prints
is its **final reply**: the line of its stream that ends the run (Claude Code's
`result` event; for Gemini CLI, the text it wrote after its last tool call,
closed by its `result` event), kept as the stream passes, so a log cut at its
size limit still has it. Claude Code's `result` event also says what the run
cost: its turns, its tokens in (the cache's reads and writes counted) and out,
and its cost in dollars. Bay sends them with the job's end, a failed run's
too, and Lore shows them on the job's page and its list of jobs.

A `job-run` carries nothing but its id. The machine pulls the job's spec over
HTTPS by that id and checks every field before anything runs: the kind, the
agent (one of the CLIs Bay has an adapter for), the model, the project and
workspace names, the source, the Lore MCP URL (on the Lore this machine is
connected to), the prompt and the timeout. Bay builds the command line itself from the agent's
adapter, so nothing Lore sends is run as written. A field Bay does not know
refuses the job.

The job's Lore key reaches the agent in its environment only: each adapter's
MCP configuration names the variable, never the key, so it is on no command line
`ps` shows and in no file.

The output goes back up the connection as it is printed, with Bay's own
timestamped steps (mirror fetched, workspace ready, agent started, agent
exited). The job's last acknowledgement carries the commit its source resolved,
a kept worktree's warning, and the agent's final reply (up to 32 KB, marked when
it was cut). An agent that ended on an error has no reply: its words are the
failure's reason. A job that printed no final line simply has none. The
machine's inventory says it returns replies, so Lore can tell a host running an
older Bay. If the link
drops mid-job, the job keeps running and its output waits on disk until Lore is
back. A timeout kills the job's whole process group; so does `job-cancel`.

A Claude Code job takes its prompt on its standard input rather than its
command line, and that input stays open while the job runs: `job-message`
writes a member's message to it, which the agent reads after the tool call it
is running, or at once when it sits waiting on a background task. Bay closes
the input once a turn ended with no background task left, so a job nobody
writes to ends as it would have.

**Jobs are refused until somebody who manages the host allows them**, with a
switch of their own, separate from deploys. A host runs its jobs in two lanes,
each with its own limit: the jobs that change code, one at a time unless
`--max-jobs` says more, and the others, which read the code or take none, 8 at a
time unless `--max-read-jobs` says otherwise. Lore sends up to that many of each,
so a job that only reads never waits behind one that changes code. Jobs that read
share a workspace; a job that changes code has its own to itself. A job the host cannot
start yet (its slots are full, its workspace is held) is acknowledged **busy**,
and Lore sends it again once one of the host's jobs ends. A job never makes a
deploy wait. A host that only runs jobs needs no Docker.

### The jobs user

Bay runs a job as a **dedicated Unix user**, never root and never the user Bay
runs as. Create the user, install an agent CLI for it and sign it in as that
user by hand: Lore never configures the agent and never sees its sign-in.

```bash
sudo useradd --create-home bay-agent
sudo -iu bay-agent claude              # or: gemini
sudo bay config jobs --user bay-agent
```

The agent must be on that user's `PATH` (`~/.local/bin`, `~/.npm-global/bin`,
`~/bin`, `/usr/local/bin` or `/usr/bin`). Install `git` and `gh` there too, and
**sign `gh` in**: a job that reads or changes the project's code needs the
repository on GitHub, and Bay fetches it through the jobs user's `gh`. Bay holds
no credential.

```bash
sudo -iu bay-agent gh auth login
```

`bay doctor` lists what the jobs user has, and the host reports the same list
to Lore: each agent CLI, `git`, `gh`, `cf` (Cloudflare's CLI) and `lore`, with
a version or the error of its version command, and whether each is signed in,
read with the tool's own status command. A job fails at once, before any git,
when a tool it needs says it is signed out: its agent CLI, and `gh` for a job
with code. `lore` is the exception: it must **not** be signed in as the jobs
user, since a job reaches Lore with a key held to its project, and `bay doctor`
warns when it is (`sudo -iu bay-agent lore logout`).

`bay config jobs --max-jobs 2` lets two jobs that change code run at once (one
by default). `bay config jobs --max-read-jobs 4` sets how many of the others run
beside them (8 by default, 16 at most).
`bay config jobs --fetch-ttl 30s` is how long a fetch of a project's repository
is good for (30 seconds by default, `0` fetches before every job).
`bay config jobs --clear` makes the host refuse every job again.

⚠️ **There is no sandbox.** A job has the jobs user's shell on the machine, its
network and its sign-ins. Give that user only what the jobs need, and run the
jobs on a machine you would trust a colleague with for the same work. Lore
gives an agent no text written outside the project's team until a member has
trusted it.

### Sources and workspaces

A job's **source** is the code it finds when it starts, prepared by Bay so the
agent never clones or fetches:

- **none**: an empty workspace;
- **read**: the repository at a ref (the default branch unless the job names a
  branch, a tag, a commit or `pull/<n>/head`), checked out once per commit and
  made read-only, at `./src` in the job's workspace. Read jobs of a project run
  together; `./src` moves to a newer commit only when no job holds the
  workspace;
- **write**: a git worktree on the job's branch, which continues the branch on
  GitHub when it exists and starts from the ref otherwise.

Bay keeps one **mirror** of each project's repository,
`~/bay-jobs/<project>/.mirror`, a bare clone fetched as the jobs user with
`gh` as its credential helper, at most once per `--fetch-ttl`. Read trees and
worktrees are made from it.

A job runs in `~/bay-jobs/<project>/<workspace>`, kept between runs. Lore names
the workspace (`triage`, `review`, `text`, `q<number>` for a quest's work) and
asks the machine to remove one when a quest is completed or its project
deleted.

**A write worktree is removed when its job ends**, whatever the exit, once
every commit is pushed and the tree is clean. Otherwise Bay **keeps** it, says
so in the log and in the job's warning, and refuses the next job on that
workspace until someone pushes or removes it.

A job at `pull/<n>/head` may ask Bay to check its author: Bay asks GitHub, with
the jobs user's `gh`, whether the author can write to the repository, and fails
the job before its agent starts when they cannot. A write job on a pull
request works on the pull request's own branch, and is refused for a fork.

```bash
sudo bay jobs workspaces
sudo bay jobs workspace rm acme/q12
```

`bay jobs workspaces` lists the workspaces, the mirror, the read trees and the
kept worktrees. A removal is refused while a job runs in that workspace.

A Bay older than job sources has no `sources` in its inventory: Lore refuses to
send it a job that reads or changes code, and says to upgrade Bay there. Its
jobs with no code keep running.

## The console

Once the machine has said hello, `/<project>/hosts/<host>` in Lore shows,
to every member of the host's project (acting on it takes `host:update`
there):

- the host's memory, disk and load;
- every instance with its state, release, memory, restarts and backup freshness;
- the commands anyone queued, and what came back.

Its apps table also answers what the host cannot answer alone: an instance Lore
expects that the machine did not report is a failed deploy or a removed unit.

## Monitor only

`bay agent` runs the connector and nothing else, for a machine Bay does not run
apps on: it reports the host's CPU, memory, disk and load to Lore, and Lore's
host page shows them. It opens no port (no proxy, no TLS, no ACME, no control
socket), needs no Docker, and runs as a plain user, with its data under the
user's home (`~/.local/state/bay`, or `--root`).

Every command Lore sends it is refused on the machine, whatever its kind: a
deploy, a restart, a backup, an upgrade. Lore shows the host as **Monitor
only** and queues no command for it.

The installer sets it up for the user who runs it, with no `sudo`:

```bash
curl -sSL https://alepha.dev/bay/install.sh \
  | BAY_MONITOR_ONLY=1 LORE_URL=https://lore.alepha.app LORE_ESTATE_SECRET=est_... sh
```

It installs Bay under `~/.local/share/bay`, writes a systemd user unit
(`~/.config/systemd/user/bay-agent.service`) running `bay agent`, starts it and
enrols it. To keep it running after the user logs out, an administrator runs
`loginctl enable-linger <user>` once. By hand, without the installer:

```bash
bay agent --root ~/.local/state/bay &
bay connector set --root ~/.local/state/bay <lore-url> <secret>
```

The agent reads the connector file before each dial, so it connects at its
next attempt whichever runs first. Upgrade it by running the installer again.

## Rotating and revoking

Rotating the secret in Lore refuses the machine on its next dial; run
`bay connector set` again with the new one. Deleting the host refuses it for
good. Neither touches what runs on the host.

For the Lore side (creating hosts, allowing deploys, `lore deploy`), see the
[Lore documentation](/lore/docs/start-introduction).
