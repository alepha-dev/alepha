# Lore connector

Enrol a Bay host as an **estate** of a Lore instance, so Lore can show what the
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
  Bay->>Lore: dial wss://lore.example.com/ws/estates with the estate secret
  Lore-->>Bay: accepted, with the estate's name
  Bay->>Lore: inventory: host load, apps, releases, backups
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
when `install.sh` is given the Lore URL and the estate's secret:

```bash
curl -sSL https://alepha.dev/bay/install.sh \
  | sudo LORE_URL=https://lore.alepha.dev LORE_ESTATE_SECRET=est_... sh
```

The installer writes the unit from the installation guide unless one exists,
waits for `bay serve`, runs `bay connector set`, and never prints the secret.
On a host already running Bay:

1. In Lore, create an estate in a project with Apps on: from its
   **Settings ▸ Apps ▸ Estates**, or with `lore estate add <slug>`. The
   estate belongs to that project. The secret is shown **once**.
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
| ------------------------------ | -------------------------------------------------------------------------------- |
| `bay connector set URL SECRET` | enrol, or re-enrol with a rotated secret                                         |
| `bay connector show`           | the Lore URL, the estate name and whether the connection is up; never the secret |
| `bay connector clear`          | forget both: the machine dials nobody                                            |

`http://` is accepted for a loopback Lore only, so a secret never crosses a
network in clear.

## What Lore can make the machine do

A **closed vocabulary of fourteen verbs**, each naming one app instance or stack
environment. `deploy` and `stack-deploy` create what they name, `remove` and
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

⚠️ **This list is a security boundary, not a menu.** It is all that Lore, or
whoever controls Lore, can ask of this machine. No verb takes a path, a shell
command or an argument list; `logs` carries a line count, a time window and a
pattern, all bounded and validated; `backup-policy` carries a policy checked
like `bay backup config`'s, and `restore` a backup key or a time, the instance
to restore from and a reason. Both are held to the same switch as `deploy`,
and Lore refuses them while the machine is offline rather than queueing them.
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

**Deploys are refused until somebody who manages the estate allows them** (a
member of its project whose rank grants `estate:update`), and
the machine enforces that switch on its own side too. `stack-deploy` is held to
the same switch: it runs containers of the bundle's choosing, so allowing
deploys on an estate is trusting Lore with the host. A bundle goes through the
checks of any [compose file](/bay/docs/guides-stacks#the-compose-file), and only
those: no bind mount outside its own directory and no Docker socket, but
`devices`, `cap_add` and `security_opt` pass, and `x-lore.tcp: N` opens public
port N.

Stack members are addressed by the same verbs, as the instance
`<stack>.<service>`. A Lore `stack-deploy` also carries the environment's routes
and base domain, which replace those set with `bay stack route`.

## The console

Once the machine has said hello, `/<project>/estates/<estate>` in Lore shows,
to every member of the estate's project (acting on it takes `estate:update`
there):

- the host's memory, disk and load;
- every instance with its state, release, memory, restarts and backup freshness;
- the commands anyone queued, and what came back.

Its apps table also answers what the host cannot answer alone: an instance Lore
expects that the machine did not report is a failed deploy or a removed unit.

## Rotating and revoking

Rotating the secret in Lore refuses the machine on its next dial; run
`bay connector set` again with the new one. Deleting the estate refuses it for
good. Neither touches what runs on the host.

For the Lore side (creating estates, allowing deploys, `lore deploy`), see the
[Lore documentation](/lore/docs/start-introduction).
