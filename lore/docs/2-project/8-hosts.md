# Hosts

A host is a machine or an account Lore works with: a server of yours running
[Bay](/bay/docs/guides-introduction), or a Cloudflare account. It belongs to
one project, its **home**, whose members manage it, and the home can lend it to
other projects.

Every project has hosts, whatever its capabilities (see
[Capabilities](/lore/docs/project-capabilities)). A project's hosts are in
**Settings ▸ General ▸ Hosts**: the ones it is the home of, and the ones other
projects lend it. Your account has no hosts page, since a host is never
yours alone.

## What a host does

A host does one or more things, shown as pills in the hosts list:

| Role       | What it is                                                                                  | Needs                                            |
| ---------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **stats**  | The server reports its CPU, memory and disk, and Lore tells you when it goes offline.       | A Bay host. Nothing else.                        |
| **agent**  | The server runs [agent jobs](/lore/docs/agents-jobs) for the project.                       | A Bay host with jobs allowed.                    |
| **deploy** | Projects deploy their apps and stacks onto it (see [Deploying](/lore/docs/ship-deploying)). | The Ship capability in the project that deploys. |

A Bay host enrolled only to watch a server's memory is a host like any other,
in a project with no Ship at all.

### A project that only stores hosts

A project may exist only to hold hosts and lend them. Its members manage the
servers, read their stats and get their alerts; the projects that deploy
borrow them, with Ship on in their own settings. The store project needs no
Ship, and turning Ship off in a project never touches its hosts.

## The two kinds

| Kind           | What it is            | What it runs                              | How Lore reaches it                                                                                           |
| -------------- | --------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Bay**        | A server running Bay. | Apps and [stacks](/lore/docs/ship-stacks) | The server connects out to Lore, with a secret Lore creates. No port has to be opened on the server for Lore. |
| **Cloudflare** | A Cloudflare account. | Apps, as Workers                          | Lore calls Cloudflare's API with the account id and an API token you create.                                  |

## Adding a host

1. Open **Settings ▸ General ▸ Hosts** and click **Add a host**.
2. Choose **Create a new one**. (**Use one of mine** lends a host that
   already exists, see [Lending](#lending-a-host-to-another-project).)
3. Pick the kind, **Bay** or **Cloudflare**, and give the host a **Name**:
   lowercase letters, digits and hyphens, such as `ovh-1`. The name appears in
   URLs and commands and never changes afterwards. It is unique inside its
   home project, so two projects may both have an `ovh-1`.
4. Read the warning under the form, then click **Create and lend**.

⚠️ The warning says what you are granting: everyone who can deploy in the
project will be able to run code on that server, with everything it holds, or
in that Cloudflare account, with its storage and secrets.

The new host belongs to the project and is lent to it in the same step.

### A Bay host

Lore shows the host's secret, once, with the command to run on the server as
root:

```bash
bay connector set <lore-url> <secret>
```

`<lore-url>` is the address of the Lore instance (`https://lore.alepha.app`,
or yours when self-hosted), not the server's.

On a fresh server, Bay's installer installs Bay, starts it and runs that
command, in one line:

```bash
curl -sSL https://alepha.dev/bay/install.sh \
  | sudo LORE_URL=https://lore.alepha.app LORE_ESTATE_SECRET=est_... sh
```

Add `BAY_BASE_DOMAIN=<domain>` to that line to say what apps deployed there are
named under (`<app>.<domain>`): without a base domain, Bay refuses to deploy
an app. A server with no domain of its own can use its IP through sslip.io,
for example `203-0-113-10.sslip.io`: the name resolves to the IP and Bay gets a
real certificate for it.

⚠️ The secret is shown **once**. Lore keeps only a hash of it and cannot show
it again. If it is lost, **Rotate secret** on the host's console creates a
new one, and the old one stops working at that moment: the server stays
offline until the command is run again with the new secret.

Once Bay has connected, the host shows as **online**. See
[Lore connector](/bay/docs/guides-lore-connector) in the Bay documentation for
the server's side.

A machine you only want to watch, with no app on it and no root access, runs
Bay as a monitor: add `BAY_MONITOR_ONLY=1` to the installer line and drop
`sudo`. It reports the host's CPU, memory and disk, opens no port and takes no
command, and its console shows **Monitor only**. See
[Monitor only](/bay/docs/guides-lore-connector#monitor-only).

### A Cloudflare host

Pick **Cloudflare**, then paste the **Cloudflare account id** (32 characters)
and the **Cloudflare API token**. Lore checks the token against the account
before it creates anything, and again every night. If the token lacks a
permission, the dialog says which one and nothing is saved.

Which token to create, with which permissions, is the whole of
[The Cloudflare token](/lore/docs/ship-cloudflare-token). A Cloudflare host
is created in the browser only: `lore host add` creates Bay hosts.

### A server bought for you

`lore host provision` buys the server too. It drives the provider's own
command-line tool, the one you installed and signed in with, so Lore never
holds a key to your cloud account:

```bash
brew install scw && scw login       # once
lore host provision --provider scaleway --project acme
```

In about three minutes, with no SSH and no page:

1. The server is created (a DEV1-S in fr-par-1 unless `--type` and `--zone`
   say otherwise) with its own public IP.
2. On first boot it installs Docker and Bay and connects with a one-time
   secret, which stops working once the server has connected.
3. Its apps are named under `<ip-with-dashes>.sslip.io`, with no DNS to set
   up.
4. The command waits until the server is online (`--timeout`, 300 seconds by
   default) and prints its address, its price, and what to run next.

`--project` is required. The project is created with Ship on when it does not
exist; an existing project with Ship off takes the host too, and the command
says that deploys there wait for Ship. The host is named with three random words unless you pass `--name`,
and it accepts deploys (`--no-allow-deploys` for a server that only reports its
stats). Run the command without `--provider` to list the providers and what
each needs.

⚠️ The server is billed by its provider until it is terminated. If anything
fails after the server exists, the command terminates it before answering. If
that fails too, it keeps the host and prints the command that finishes the
job, so no server bills where you cannot see it.

The server lives in the cloud account of whoever ran the command. The hosts
list marks the host with its provider and server type, and its console shows
the server, its zone, its hourly price, an estimate of what it has cost so far,
and who bought it.

## Accepting deploys

A Bay host added by hand reports its stats and does **not** accept deploys.
When the server is ready, turn **Allow deploys** on, on the **Settings** tab of
its [console](#the-console-of-a-bay-host). While the switch is off, the list
shows **stats only** and no project can deploy through the host, whatever it
was lent.

A Cloudflare host accepts deploys from creation. The same switch, in its
[drawer](#the-drawer-of-a-cloudflare-host), turns them off.

Then each app instance picks its host on its own **Settings** tab, and a
stack names its host in its own settings. A deploy never asks which machine:
it goes where the instance or the stack says. See
[Deploying an app](/lore/docs/ship-deploying) and
[Stacks](/lore/docs/ship-stacks).

## Who can do what

Five permissions decide it, all read in the host's home project:

| Permission    | Lets a member                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host:read`   | See the project's hosts and open their consoles: what runs on a server, the commands sent to it, its CPU and memory.                                      |
| `host:update` | Change one: allow deploys, the stats switches, the label and expiry, rotate its secret or replace its token, send it commands, and ask for and read logs. |
| `host:create` | Add a host to the project, by hand or by buying a server.                                                                                                 |
| `host:delete` | Delete a host of the project, or move it to another project.                                                                                              |
| `host:lend`   | Lend a host to another project, and take a loan back.                                                                                                     |

By default the project's owner can do everything and a plain member can look:
`host:read` is in the Member rank, the other four are not. A rank is how more
people are let in, and the **Admin** preset carries all five (see
[Members](/lore/docs/project-members)).

Three things are worth knowing:

- Reading logs is under `host:update`, with asking for them, because a
  server runs the apps of every project that borrows it.
- In the browser, **Add a host** is offered to a rank that holds
  `host:lend`, since the same dialog lends. Creating a new host there
  takes `host:create` as well.
- A member of a project that only borrows a host sees that it exists and
  whether it is up, and deploys onto it. They cannot open it, change it or
  read its logs.

When a member leaves, nothing changes for the host. It belongs to the
project, not to the person who added it, so the people whose rank allows it
keep managing it.

## Lending a host to another project

A host is lent to its home when it is created. For another project to
deploy onto it:

1. Open **Settings ▸ General ▸ Hosts** in the project that borrows, and click
   **Add a host**.
2. Under **Use one of mine**, pick the host. The list offers the hosts you
   may lend.
3. Read the warning, then click **Lend it to this project**.

Lending takes `host:lend` in both projects, since the borrower's members can
then run code on the server. They deploy there and do nothing else.

In the hosts list, the **Origin** column tells the two apart: **This
project** for a host whose home is here, **Lent** for a borrowed one, with
the name of the project that lends it.

To withdraw a loan, use **Detach**: on the host's row in the borrowing
project, or beside the project in the **Lent to** list of the host's console
or drawer. It takes `host:lend` on either side. Nothing already deployed is
touched: the server keeps running whatever it runs.

⚠️ Detaching is refused while an app instance or a stack of that project still
deploys onto the host. Point it at another host or delete it first.

## Moving a host to another project

A host changes home from its console: **Settings ▸ Move to another
project**. It takes `host:delete` in the home it leaves and `host:create`
in the one it joins, with or without Ship.

Its name, its server, its secret, its commands and its loans stay. The
previous home keeps deploying there through its loan, and the dialog lists the
loans that remain. The new home gets no loan from the move: its list shows
**Not lent to this project** until somebody uses **Lend to this project** on
the host's row.

A move is refused when the new home already has a host of that name, since
a name never changes. A server bought with `lore host provision` stays in
the cloud account that bought it.

## Deleting a host

**Delete** is on the **Settings** tab of a Bay host's console and in a
Cloudflare host's drawer. It takes `host:delete` in the host's home
project.

⚠️ Deleting stops nothing. The server keeps running whatever it runs, and Lore
only loses the ability to inspect it, deploy to it or roll back through it.
For a Bay host the secret is revoked, so Bay is refused the next time it
connects. A Cloudflare token is not revoked at Cloudflare: do that there. Every
project the host was lent to loses it. Delete the server with its provider
afterwards.

⚠️ For a server bought with `lore host provision`, deleting from the page
does not terminate the server: Lore holds no key to a cloud account, so the
server keeps running, and billing. The dialog says so and gives the command
that does both, `lore host delete <name> --yes`.

Deleting is refused while an app instance, a stack or a stack environment, in
any project, still deploys onto the host. The refusal names them: point them
at another host or remove them first.

A project that is the home of a host cannot be deleted: other projects may
deploy onto its hosts. Its danger zone names the hosts in the way. Move or
delete them first. Turning Ship off is allowed: the hosts stay.

## The console of a Bay host

Clicking a Bay host in the list opens its console, at
`/<project>/hosts/<host>`, with these tabs (Processes only while the project
has Ship on):

| Tab       | What it shows                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------- |
| Overview  | Whether the server is online, when it last reported, its memory, disk and CPU, and its stacks. |
| Processes | What runs on it, beside what Lore expected, with **Restart**, **Stop** and **Start**.          |
| Commands  | What Lore has asked it to do, and how each went.                                               |
| Settings  | The host's own settings.                                                                       |

Every member of the home project can open the console and look. Acting on it
(a restart, a switch, a rotation, reading logs) takes `host:update`. From a
project that only borrows the host, the console opens for nobody but the
members of its home.

A stopped app stays stopped, across a reboot and a Bay upgrade: the way back
is **Start**, or a deploy. A command sent while the server is offline waits
for it to come back, and is given up on after a day. Logs cannot be read while
it is offline.

The **Settings** tab holds, for whoever the rank allows:

- the host's home project and who added it, with **Move to another
  project**;
- **Allow deploys**;
- **Keep a history of CPU and memory** and **Stats interval**, for the
  server's stats;
- the projects it is lent to, each with **Detach**;
- **Rotate secret** and **Delete**.

A member who may only look sees a Settings tab that says so, and which
permission would let them do more.

### Upgrading Bay

The Overview says which version of Bay the server runs. When a newer release
exists it reads "Bay 0.39.0 → 0.40.0", with an **Upgrade Bay** button for
whoever holds `host:update` in the host's home project. A project that only
borrows the host cannot upgrade it.

Pressing it asks for confirmation, then follows the upgrade to its end:
"Upgraded to 0.40.0" once the new version serves, or the reason the server
gave. Nothing is interrupted while it runs:

- connections are handed over to the new version, so no request is refused;
- apps keep running, unless the new version changes how Bay builds their
  containers, in which case each restarts once;
- if the new version fails to start, the current one keeps serving.

The button is shown but cannot be pressed, with the reason under it, in two
cases:

- **the home project has not allowed deploys on the host.** An upgrade is
  held to **Allow deploys**, like a deploy;
- **the host is offline.** An upgrade is never kept waiting for a server to
  come back.

Some hosts are upgraded by hand instead. The Overview then shows no button,
says why, and gives one command to copy and run on the server:

- its Bay is too old to be upgraded from Lore;
- its systemd unit has no handoff drop-in;
- its Bay does not run under systemd.

```bash
curl -sSL https://alepha.dev/bay/install.sh | sudo BAY_VERSION=0.40.0 BAY_UPDATE_UNIT=yes sh
```

That command upgrades Bay and sets the server up for the next time: from then
on, the upgrade is the button. See
[Upgrading Bay](/bay/docs/guides-installation#upgrading-bay) for what it
changes on the server.

Three more things to know:

- **Lore never takes a host back to an older version.** That is done on the
  server, with the same installer and the older `BAY_VERSION`.
- **A host that went offline during an upgrade and has not come back** reads
  "Offline since the upgrade", with the command that puts the previous
  version back.
- **The version offered is the release your Lore itself runs.** A new release
  shows up as the target once Lore has been updated to it, not the day it is
  published.

## The drawer of a Cloudflare host

A Cloudflare host has no console. Clicking it in the list opens a drawer
with **Allow deploys** and:

- **Replace token**, to paste a new token over the old one;
- **Check again**, to ask Cloudflare now instead of waiting for the nightly
  check;
- the projects it is lent to, each with **Detach**;
- **Delete**.

A token that has expired or that Cloudflare refuses shows as **credential
invalid**, and deploys are refused until it is replaced.

## Who is told

Four events are recorded in the host's home project, once per occurrence,
never in the projects it is lent to:

- a Cloudflare token stops working.
- a host is past its expiry. A server meant to be temporary can be given
  one from the command line (`lore host add --ttl 2h`, or `lore host
  update --ttl`). Past it the host shows **overdue**. Lore stops nothing and
  deletes nothing.
- a Bay host goes **offline**: its connection closed, or it stopped reporting,
  and it has not come back for five minutes. A restart or an upgrade of Bay
  reconnects in seconds and raises nothing. A host past its TTL is not
  reported, since going away is what it was meant to do.
- that host comes **back online**, once per outage.

Nobody is told until someone asks: the bell on a host's console subscribes you
to that host, the one on **Settings** > **Hosts** to every host of the project.
Each bell's dialog can leave any of the four events out. **Settings ▸
Notifications** can also notify anyone of them, or post them to a Discord or
webhook channel. See [Notifications](/lore/docs/project-notifications).

## For an instance admin

The admin area's **Hosts** page lists every host of the instance, with its
home project, who created it, and the projects it is lent to. An admin can
delete one, and move one to another home: **Assign to project** offers the
projects it is lent to first. Assigning touches no loan, and the admin still
reads no credential. Every host has a home project.

## From the command line

Most of this page has a command. From a project directory:

```bash
lore host add my-vps --label "My VPS"     # a Bay host, and its secret
lore host wait my-vps --timeout 120       # exit 0 once online, 1 on timeout
lore host list                            # home or borrowed, and their state
lore host get my-vps                      # one host, and what it runs
lore host update my-vps --allow-deploys   # or --no-allow-deploys, --label
lore host update my-vps --stats-history   # keep CPU and memory, --stats-interval 5m
lore host upgrade my-vps                  # upgrade its Bay, and wait for it
lore host rotate my-vps                   # a new secret, shown once
lore host lend my-vps --project shop      # unlend withdraws the loan
lore host move my-vps --to platform --yes
lore host delete my-vps --yes
```

- `lore host add --output json` prints the secret and the command as JSON,
  for a script. With `lore host wait`, a fresh server is enrolled from a
  shell with no page in the loop:
  [A throwaway server](/bay/docs/tutorials-a-throwaway-server) walks through
  it.
- `lore host delete` only acts on a host the project is the home of,
  never on one it borrows. Without `--yes` it asks first, and with no terminal
  to ask on it refuses. `--output json` answers `{ ok, id, slug, revoked }`,
  with `server` and `terminated` for a bought server.
- For a server `lore host provision` bought, `lore host delete` also
  terminates the server, with its IP and its disk, through the provider's
  tool. This cannot be undone. Lore is asked first whether it would accept the
  delete, so a refused delete destroys nothing. If terminating fails, the
  host is kept and the command that finishes is printed. `--keep-server`
  deletes the host and leaves the server running.
- `lore host upgrade` is the **Upgrade Bay** button: it waits until the new
  version serves and prints it, or exits `1` with the server's reason.
  `--version 0.40.2` picks another release, newer than the one the host
  runs; `--no-wait` returns once the upgrade is queued. Where the page would
  show the command to run by hand, it prints that command. `lore host list`
  shows each host's Bay version, and the release available when it is
  behind.
- When a command could mean two hosts of one name, it refuses and names
  their projects. `--home <project>` picks one.
- `lore host assign <host id> --to <project>` is the admin's **Assign to
  project**.

The full list is in [The lore CLI](/lore/docs/reference-cli#hosts).

## From an agent

No MCP tool creates, moves, assigns or deletes a host, on purpose: those
stay a person's acts. An agent deploys an app it names by app and environment,
and the app already knows its host, so no deploy tool takes a machine.
`app_instance_update` can point an app at a host lent to the project
(`hostId`), `host_stats` reads a host's CPU and memory, and an agent
never sees a host's secret. No tool upgrades Bay either: that is the button,
or `lore host upgrade`. See
[MCP tools](/lore/docs/reference-mcp-tools).

## Next

- [The Cloudflare token](/lore/docs/ship-cloudflare-token): which token to
  create for a Cloudflare host.
- [Deploying an app](/lore/docs/ship-deploying): pick a host and ship a
  build.
- [Stacks](/lore/docs/ship-stacks): deploy a Compose file onto a Bay host.
- [Apps and instances](/lore/docs/ship-instances): what an app, an instance
  and a sigil are.
