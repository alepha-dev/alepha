# Estates

An estate is a place a project deploys to: a server of yours running
[Bay](/bay/docs/guides-introduction), or a Cloudflare account. It belongs to
one project, its **home**, whose members manage it, and the home can lend it to
other projects so that they deploy there too.

Estates live in projects with the **Apps** capability on (see
[Capabilities](/lore/docs/project-capabilities)). A project's estates are in
**Settings ▸ Apps ▸ Estates**: the ones it is the home of, and the ones other
projects lend it. Your account has no estates page, since an estate is never
yours alone.

## The two kinds

| Kind           | What it is            | What it runs                              | How Lore reaches it                                                                                           |
| -------------- | --------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Bay**        | A server running Bay. | Apps and [stacks](/lore/docs/apps-stacks) | The server connects out to Lore, with a secret Lore creates. No port has to be opened on the server for Lore. |
| **Cloudflare** | A Cloudflare account. | Apps, as Workers                          | Lore calls Cloudflare's API with the account id and an API token you create.                                  |

## Adding an estate

1. Open **Settings ▸ Apps ▸ Estates** and click **Add an estate**.
2. Choose **Create a new one**. (**Use one of mine** lends an estate that
   already exists, see [Lending](#lending-an-estate-to-another-project).)
3. Pick the kind, **Bay** or **Cloudflare**, and give the estate a **Name**:
   lowercase letters, digits and hyphens, such as `ovh-1`. The name appears in
   URLs and commands and never changes afterwards. It is unique inside its
   home project, so two projects may both have an `ovh-1`.
4. Read the warning under the form, then click **Create and lend**.

⚠️ The warning says what you are granting: everyone who can deploy in the
project will be able to run code on that server, with everything it holds, or
in that Cloudflare account, with its storage and secrets.

The new estate belongs to the project and is lent to it in the same step.

### A Bay estate

Lore shows the estate's secret, once, with the command to run on the server as
root:

```bash
bay connector set <lore-url> <secret>
```

`<lore-url>` is the address of the Lore instance (`https://lore.alepha.dev`,
or yours when self-hosted), not the server's.

On a fresh server, Bay's installer installs Bay, starts it and runs that
command, in one line:

```bash
curl -sSL https://alepha.dev/bay/install.sh \
  | sudo LORE_URL=https://lore.alepha.dev LORE_ESTATE_SECRET=est_... sh
```

Add `BAY_BASE_DOMAIN=<domain>` to that line to say what apps deployed there are
named under (`<app>.<domain>`): without a base domain, Bay refuses to deploy
an app. A server with no domain of its own can use its IP through sslip.io,
for example `203-0-113-10.sslip.io`: the name resolves to the IP and Bay gets a
real certificate for it.

⚠️ The secret is shown **once**. Lore keeps only a hash of it and cannot show
it again. If it is lost, **Rotate secret** on the estate's console creates a
new one, and the old one stops working at that moment: the server stays
offline until the command is run again with the new secret.

Once Bay has connected, the estate shows as **online**. See
[Lore connector](/bay/docs/guides-lore-connector) in the Bay documentation for
the server's side.

### A Cloudflare estate

Pick **Cloudflare**, then paste the **Cloudflare account id** (32 characters)
and the **Cloudflare API token**. Lore checks the token against the account
before it creates anything, and again every night. If the token lacks a
permission, the dialog says which one and nothing is saved.

Which token to create, with which permissions, is the whole of
[The Cloudflare token](/lore/docs/apps-cloudflare-token). A Cloudflare estate
is created in the browser only: `lore estate add` creates Bay estates.

### A server bought for you

`lore estate provision` buys the server too. It drives the provider's own
command-line tool, the one you installed and signed in with, so Lore never
holds a key to your cloud account:

```bash
brew install scw && scw login       # once
lore estate provision --provider scaleway --project acme
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

`--project` is required. The project is created with Apps on when it does not
exist; an existing project with Apps off is refused before any server is
bought. The estate is named with three random words unless you pass `--name`,
and it accepts deploys (`--no-allow-deploys` for a server that only reports its
stats). Run the command without `--provider` to list the providers and what
each needs.

⚠️ The server is billed by its provider until it is terminated. If anything
fails after the server exists, the command terminates it before answering. If
that fails too, it keeps the estate and prints the command that finishes the
job, so no server bills where you cannot see it.

The server lives in the cloud account of whoever ran the command. The estates
list marks the estate with its provider and server type, and its console shows
the server, its zone, its hourly price, an estimate of what it has cost so far,
and who bought it.

## Accepting deploys

A Bay estate added by hand reports its stats and does **not** accept deploys.
When the server is ready, turn **Allow deploys** on, on the **Settings** tab of
its [console](#the-console-of-a-bay-estate). While the switch is off, the list
shows **stats only** and no project can deploy through the estate, whatever it
was lent.

A Cloudflare estate accepts deploys from creation. The same switch, in its
[drawer](#the-drawer-of-a-cloudflare-estate), turns them off.

Then each app instance picks its estate on its own **Settings** tab, and a
stack names its estate in its own settings. A deploy never asks which machine:
it goes where the instance or the stack says. See
[Deploying an app](/lore/docs/apps-deploying) and
[Stacks](/lore/docs/apps-stacks).

## Who can do what

Five permissions decide it, all read in the estate's home project:

| Permission      | Lets a member                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `estate:read`   | See the project's estates and open their consoles: what runs on a server, the commands sent to it, its CPU and memory.                                    |
| `estate:update` | Change one: allow deploys, the stats switches, the label and expiry, rotate its secret or replace its token, send it commands, and ask for and read logs. |
| `estate:create` | Add an estate to the project, by hand or by buying a server.                                                                                              |
| `estate:delete` | Delete an estate of the project, or move it to another project.                                                                                           |
| `estate:lend`   | Lend an estate to another project, and take a loan back.                                                                                                  |

By default the project's owner can do everything and a plain member can look:
`estate:read` is in the Member rank, the other four are not. A rank is how more
people are let in, and the **Admin** preset carries all five (see
[Members](/lore/docs/project-members)).

Three things are worth knowing:

- Reading logs is under `estate:update`, with asking for them, because a
  server runs the apps of every project that borrows it.
- In the browser, **Add an estate** is offered to a rank that holds
  `estate:lend`, since the same dialog lends. Creating a new estate there
  takes `estate:create` as well.
- A member of a project that only borrows an estate sees that it exists and
  whether it is up, and deploys onto it. They cannot open it, change it or
  read its logs.

When a member leaves, nothing changes for the estate. It belongs to the
project, not to the person who added it, so the people whose rank allows it
keep managing it.

## Lending an estate to another project

An estate is lent to its home when it is created. For another project to
deploy onto it:

1. Open **Settings ▸ Apps ▸ Estates** in the project that borrows, and click
   **Add an estate**.
2. Under **Use one of mine**, pick the estate. The list offers the estates you
   may lend.
3. Read the warning, then click **Lend it to this project**.

Lending takes `estate:lend` in both projects, since the borrower's members can
then run code on the server. They deploy there and do nothing else.

In the estates list, the **Origin** column tells the two apart: **This
project** for an estate whose home is here, **Lent** for a borrowed one, with
the name of the project that lends it.

To withdraw a loan, use **Detach**: on the estate's row in the borrowing
project, or beside the project in the **Lent to** list of the estate's console
or drawer. It takes `estate:lend` on either side. Nothing already deployed is
touched: the server keeps running whatever it runs.

⚠️ Detaching is refused while an app instance or a stack of that project still
deploys onto the estate. Point it at another estate or delete it first.

## Moving an estate to another project

An estate changes home from its console: **Settings ▸ Move to another
project**. It takes `estate:delete` in the home it leaves and `estate:create`
in the one it joins, which must have Apps on.

Its name, its server, its secret, its commands and its loans stay. The
previous home keeps deploying there through its loan, and the dialog lists the
loans that remain. The new home gets no loan from the move: its list shows
**Not lent to this project** until somebody uses **Lend to this project** on
the estate's row.

A move is refused when the new home already has an estate of that name, since
a name never changes. A server bought with `lore estate provision` stays in
the cloud account that bought it.

## Deleting an estate

**Delete** is on the **Settings** tab of a Bay estate's console and in a
Cloudflare estate's drawer. It takes `estate:delete` in the estate's home
project.

⚠️ Deleting stops nothing. The server keeps running whatever it runs, and Lore
only loses the ability to inspect it, deploy to it or roll back through it.
For a Bay estate the secret is revoked, so Bay is refused the next time it
connects. A Cloudflare token is not revoked at Cloudflare: do that there. Every
project the estate was lent to loses it. Delete the server with its provider
afterwards.

⚠️ For a server bought with `lore estate provision`, deleting from the page
does not terminate the server: Lore holds no key to a cloud account, so the
server keeps running, and billing. The dialog says so and gives the command
that does both, `lore estate delete <name> --yes`.

Deleting is refused while an app instance, a stack or a stack environment, in
any project, still deploys onto the estate. The refusal names them: point them
at another estate or remove them first.

A project that is the home of an estate cannot be deleted, and cannot turn
Apps off: other projects may deploy onto its estates, and nobody could manage
them any more. Its danger zone and its Apps switch name the estates in the
way. Move or delete them first.

## The console of a Bay estate

Clicking a Bay estate in the list opens its console, at
`/<project>/estates/<estate>`, with four tabs:

| Tab      | What it shows                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------- |
| Overview | Whether the server is online, when it last reported, its memory, disk and CPU, and its stacks. |
| Apps     | What runs on it, beside what Lore expected, with **Restart**, **Stop** and **Start**.          |
| Commands | What Lore has asked it to do, and how each went.                                               |
| Settings | The estate's own settings.                                                                     |

Every member of the home project can open the console and look. Acting on it
(a restart, a switch, a rotation, reading logs) takes `estate:update`. From a
project that only borrows the estate, the console opens for nobody but the
members of its home.

A stopped app stays stopped, across a reboot and a Bay upgrade: the way back
is **Start**, or a deploy. A command sent while the server is offline waits
for it to come back, and is given up on after a day. Logs cannot be read while
it is offline.

The **Settings** tab holds, for whoever the rank allows:

- the estate's home project and who added it, with **Move to another
  project**;
- **Allow deploys**;
- **Keep a history of CPU and memory** and **Stats interval**, for the
  server's stats;
- the projects it is lent to, each with **Detach**;
- **Rotate secret** and **Delete**.

A member who may only look sees a Settings tab that says so, and which
permission would let them do more.

## The drawer of a Cloudflare estate

A Cloudflare estate has no console. Clicking it in the list opens a drawer
with **Allow deploys** and:

- **Replace token**, to paste a new token over the old one;
- **Check again**, to ask Cloudflare now instead of waiting for the nightly
  check;
- the projects it is lent to, each with **Detach**;
- **Delete**.

A token that has expired or that Cloudflare refuses shows as **credential
invalid**, and deploys are refused until it is replaced.

## Who is told

Two events are announced to the people who can fix them, every member of the
estate's home project whose rank grants `estate:update`, the owner among them:

- a Cloudflare token stops working;
- an estate is past its expiry. A server meant to be temporary can be given
  one from the command line (`lore estate add --ttl 2h`, or `lore estate
  update --ttl`). Past it the estate shows **overdue** and its managers are
  told once. Lore stops nothing and deletes nothing.

See [Notifications](/lore/docs/project-notifications).

## For an instance admin

The admin area's **Estates** page lists every estate of the instance, with its
home project, who created it, and the projects it is lent to. An admin can
delete one, and give one a home: **Assign to project** offers the projects it
is lent to first. Assigning touches no loan, and the admin still reads no
credential.

An estate can have **no home**. Nobody but an admin can open it, and it keeps
deploying through its loans.

⚠️ An estate with no home is still tied to the account of the person who
created it: deleting that account deletes the estate, and the account deletion
dialog says so. Assigning the estate a home ends both.

An instance upgraded from an older version of Lore can hold such estates. After
the upgrade, once: open the admin area's **Estates** page, filter on **No
home**, and assign each estate listed, normally to the project it is lent to.
That project's owner then manages it.

## From the command line

Most of this page has a command. From a project directory:

```bash
lore estate add my-vps --label "My VPS"     # a Bay estate, and its secret
lore estate wait my-vps --timeout 120       # exit 0 once online, 1 on timeout
lore estate list                            # home or borrowed, and their state
lore estate get my-vps                      # one estate, and what it runs
lore estate update my-vps --allow-deploys   # or --no-allow-deploys, --label
lore estate rotate my-vps                   # a new secret, shown once
lore estate lend my-vps --project shop      # unlend withdraws the loan
lore estate move my-vps --to platform --yes
lore estate delete my-vps --yes
```

- `lore estate add --output json` prints the secret and the command as JSON,
  for a script. With `lore estate wait`, a fresh server is enrolled from a
  shell with no page in the loop:
  [A throwaway server](/bay/docs/tutorials-a-throwaway-server) walks through
  it.
- `lore estate delete` only acts on an estate the project is the home of,
  never on one it borrows. Without `--yes` it asks first, and with no terminal
  to ask on it refuses. `--output json` answers `{ ok, id, slug, revoked }`,
  with `server` and `terminated` for a bought server.
- For a server `lore estate provision` bought, `lore estate delete` also
  terminates the server, with its IP and its disk, through the provider's
  tool. This cannot be undone. Lore is asked first whether it would accept the
  delete, so a refused delete destroys nothing. If terminating fails, the
  estate is kept and the command that finishes is printed. `--keep-server`
  deletes the estate and leaves the server running.
- When a command could mean two estates of one name, it refuses and names
  their projects. `--home <project>` picks one.
- `lore estate assign <estate id> --to <project>` is the admin's **Assign to
  project**.

The full list is in [The lore CLI](/lore/docs/reference-cli#estates).

## From an agent

No MCP tool creates, moves, assigns or deletes an estate, on purpose: those
stay a person's acts. An agent deploys an app it names by app and environment,
and the app already knows its estate, so no deploy tool takes a machine.
`app_instance_update` can point an app at an estate lent to the project
(`estateId`), `estate_stats` reads an estate's CPU and memory, and an agent
never sees an estate's secret. See
[MCP tools](/lore/docs/reference-mcp-tools).

## Next

- [The Cloudflare token](/lore/docs/apps-cloudflare-token): which token to
  create for a Cloudflare estate.
- [Deploying an app](/lore/docs/apps-deploying): pick an estate and ship a
  build.
- [Stacks](/lore/docs/apps-stacks): deploy a Compose file onto a Bay estate.
- [Apps and instances](/lore/docs/apps-instances): what an app, an instance
  and a sigil are.
