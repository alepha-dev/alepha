# Estates

An estate is a place Lore deploys to: a machine running Bay, or a Cloudflare
account. It belongs to a project, its **home**, whose members manage it, each
by their rank. The home lends it to the projects that may deploy onto it,
itself included. This page explains the two kinds, who can do what, how to add
one, and how other projects come to use it.

## Two kinds

| Kind           | What it is                                             | How Lore reaches it                                                                                                    |
| -------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Bay**        | A server running [Bay](/bay/docs/guides-introduction). | Bay dials out to Lore over a websocket, with a secret Lore minted. Nothing on the machine needs an open port for Lore. |
| **Cloudflare** | A Cloudflare account, where apps run as Workers.       | Lore calls Cloudflare's API with a token somebody minted and the account id.                                           |

## Who can do what

Five permissions decide it, all read in the estate's home project:

| Permission      | Lets a member                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `estate:read`   | See the project's estates and open their consoles: what runs on a machine, the commands sent to it, its CPU and memory.                                         |
| `estate:update` | Change one: allow deploys, the stats switches, the label and expiry, rotate its secret or replace its token, send it commands, and ask for and read a log tail. |
| `estate:create` | Add an estate to the project, by hand or by buying a server.                                                                                                    |
| `estate:delete` | Delete an estate of the project, or move it to another project.                                                                                                 |
| `estate:lend`   | Lend an estate to another project, and take a loan back.                                                                                                        |

By default the project's owner can do everything and a plain member can look:
`estate:read` is in the Member rank, the other four are not. A rank is how more
people are let in: the **Admin** preset of the Ranks page carries all five. A
log tail is under `estate:update`, with asking for one, because a machine runs
the apps of every project that borrows it.

Nobody else sees an estate's console. A member of a project that only borrows an
estate sees that it exists and whether it is up, and deploys onto it; they
cannot open it, change it or read its logs.

## Adding an estate

Estates are added inside a project with **Apps** on, by somebody whose rank
there grants `estate:create`: from the project's **Settings ▸ Apps ▸ Estates**,
from the **Estates** page of your account (`/account/estates`, which asks for
the project), or with the CLI. Whichever way, the estate belongs to that
project and is lent to it. The Estates page of your account lists the estates
of every project where your rank lets you read them.

### A server bought for you

`lore estate provision` buys the server too. It drives the provider's own CLI,
the one you installed and logged in with, so Lore never holds a key to your
cloud account:

```bash
brew install scw && scw login       # once
lore estate provision --provider scaleway --project hello-world
```

In about three minutes, with no SSH and no page:

1. The server is created (a DEV1-S in fr-par-1 unless `--type` and `--zone`
   say otherwise) with its own public IP.
2. On first boot it installs Docker and Bay and enrols with a one-time
   enrolment secret, which Bay exchanges for the estate's own secret before it
   connects. The enrolment secret is the only one in the server's user data,
   and it stops working once the machine has connected.
3. Its apps are named under `<ip-with-dashes>.sslip.io`, which resolves to it
   with no DNS to set up, and Bay obtains each certificate on first request.
4. The command waits until the machine is online (`--timeout`, 300 seconds by
   default) and prints its address, its price, and what to run next.

`--project` is required: the estate belongs to that project, which is created
with Apps on when it does not exist. An existing project with Apps off is
refused before any server is bought. The estate is named with three random
words unless you pass `--name`, and it accepts deploys (`--no-allow-deploys`
for a stats-only machine). Run it without `--provider` to list the providers
and what each needs.

If anything fails after the server exists, the command terminates it before
answering; if that fails too, it keeps the estate and prints the command that
finishes the job, so no server bills where you cannot see it.

A provisioned estate carries its server: the Estates page marks it with its
provider and type, and its console and `lore estate get` show the server, its
zone, its hourly price and an estimate of what it has cost so far. The server
lives in the cloud account of whoever ran `lore estate provision`, and the
console names that person.

### A Bay estate

Create the estate from the project's **Settings ▸ Apps ▸ Estates**, from your
account's Estates page, or from a project directory with the CLI:

```bash
lore estate add my-vps --label "My VPS"
```

Lore mints the estate's secret and prints the command to run on the machine:

```bash
bay connector set <lore-url> <secret>
```

`<lore-url>` is the address of the Lore instance (`https://lore.alepha.dev`,
or yours when self-hosted), not the machine's.

On a fresh server, Bay's installer does the install, the service and that
command in one line, given the URL and the secret:

```bash
curl -sSL https://alepha.dev/bay/install.sh \
  | sudo LORE_URL=https://lore.alepha.dev LORE_ESTATE_SECRET=est_... sh
```

So a throwaway server is enrolled from a shell with no page in the loop:

```bash
SECRET=$(lore estate add my-vps --allow-deploys --output json | jq -r .secret)
ssh root@203.0.113.10 "curl -sSL https://alepha.dev/bay/install.sh | LORE_URL=https://lore.alepha.dev LORE_ESTATE_SECRET=$SECRET BAY_BASE_DOMAIN=203-0-113-10.sslip.io sh"
lore estate wait my-vps
```

`BAY_BASE_DOMAIN` is what an app deployed there is named under
(`<app>.<base>`); without one, Bay refuses an app deploy. A server with no
domain of its own can use its IP through sslip.io, as above: the name resolves
to the IP and Bay gets a real certificate for it.

⚠️ The secret is shown **once**. Lore keeps only a hash of it, so it cannot
show it again; if it is lost, rotate the estate to mint a new one
(`lore estate rotate my-vps`, or the console) and run the command again. The
old secret stops working the moment it is rotated.

A script reads the secret as JSON instead of from the sentence:

```bash
lore estate add my-vps --allow-deploys --output json | jq -r .command
```

Once Bay is connected, the estate shows as online. A script that enrolls a new
server blocks on that before its first deploy:

```bash
lore estate wait my-vps --timeout 120
```

It exits `0` once the machine is online and `1` on timeout, printing the last
state it saw. `lore estate get my-vps` reads the same estate once, with its home
project and what the machine reports running; a machine that never connected
says so. See [The Lore connector](/bay/docs/guides-lore-connector) in the Bay
documentation for the machine's side.

A slug is unique inside a home project: two projects may both have an `ovh-1`.
When a command could mean two estates of one slug, it refuses and names their
projects; `--home <project>` picks one.

### A Cloudflare estate

Paste an API token and its 32-character account id into the creation dialog.
Lore checks the token against the account before it creates anything, and again
every night. Which token to mint, and with which permissions, is the whole of
[The Cloudflare token](/lore/docs/guides-cloudflare-token).

## Accepting deploys

A new Bay estate does **not** accept deploys. Somebody with `estate:update`
turns **Allow deploys** on when it is ready, on the **Settings** tab of its
[console](#the-console-of-a-bay-estate), or passes `--allow-deploys` to
`lore estate add`. A Cloudflare estate accepts deploys from creation, and the
same switch turns them off. From a shell, `lore estate update my-vps
--allow-deploys` (or `--no-allow-deploys`) does the same, and `--label` renames
it.

The console's **Settings** tab also has, for whoever the rank allows:

- the estate's home project and who added it, with **Move to another project**;
- **Rotate secret**, to replace the estate's secret;
- **Keep a history of CPU and memory** and **Stats interval**, for the machine's
  stats;
- the projects it is lent to, each with **Detach**;
- **Delete**.

A member who may only look sees a Settings tab that says so, and which
permission would let them do more.

A Cloudflare estate has no console: clicking it on the Estates page opens a
drawer with **Allow deploys** and:

- **Replace token**, to paste a new token over the old one;
- **Check again**, to ask Cloudflare now rather than at the nightly check;
- the projects it is lent to, each with **Detach**;
- **Delete**.

A token that has expired or that Cloudflare refuses shows as
**credential invalid**, and deploys are refused until it is replaced.

## Lending an estate to another project

An estate is lent to its home when it is created. For another project to deploy
onto it, lend it there: from that project's **Settings ▸ Apps ▸ Estates**, or
from a shell:

```bash
lore estate lend my-vps --project shop
```

Lending takes `estate:lend` in both projects, since the borrower's members can
then run code on the machine. They deploy there and do nothing else. The
project's Estates tab shows two groups: the estates it is the home of, and the
ones it borrows, each naming its home. `lore estate list` says the same, for
every estate the project can deploy onto.

Withdrawing a loan (`lore estate unlend`, or **Detach**) takes `estate:lend` on
either side, and is refused while an app copy of that project still deploys onto
the estate: move or delete that copy first.

Then each app copy picks its estate on its own **Settings** tab, or an agent
sets it with `app_instance_update`. A deploy never asks which machine: it goes
where the copy says. See [Deploying an app](/lore/docs/guides-deploying). A
stack names its estate itself: `lore stack create --estate` sets its default,
and `lore stack deploy --estate` overrides that on an environment's first
deploy.

## Moving an estate to another project

An estate changes home from its console's **Settings ▸ Move to another
project**, or from a shell:

```bash
lore estate move my-vps --to platform --yes
```

It takes `estate:delete` in the home it leaves and `estate:create` in the one it
joins, which must have Apps on. Its slug, its machine, its secret, its commands
and its loans stay: the previous home keeps deploying there through its loan,
and the move prints the loans that remain. A slug the new home already holds is
refused, since a slug never changes. A provisioned server stays in the cloud
account that bought it.

## When a member leaves

Nothing changes for the estate. It belongs to the project, not to the person
who added it, so it stays, and the people whose rank allows it keep managing
it.

## Deleting an estate

Delete an estate from its console's **Settings** tab, the Cloudflare drawer, or
a shell:

```bash
lore estate delete my-vps --yes
```

It takes `estate:delete` in the estate's home project, and the slug resolves
among the estates the project is the home of: `lore estate delete` never acts
on an estate the project only borrows. Without `--yes` it asks first, and with
no terminal to ask on it refuses rather than wait. `--output json` prints
`{ ok, id, slug, revoked }` for a script, with `server` and `terminated` for a
provisioned one.

Deleting is refused while an app copy, a stack or a stack environment, in any
project, still deploys onto the estate; the refusal names each one. Repoint or
remove them first.

For an estate added by hand, nothing on the machine stops: Lore forgets the
connection, and for a Bay estate the secret is revoked, so the connector holding
it is refused on its next dial. Delete the server with its provider afterwards.

For an estate `lore estate provision` bought, `lore estate delete` also
terminates the server with its IP and its disk, through the same provider CLI,
as long as the CLI of whoever runs it can reach that server: it lives in the
cloud account of whoever provisioned it. Lore is asked first whether it would
accept the delete, so a refused delete destroys nothing; if the terminate fails,
the estate is kept and the command that finishes is printed. `--keep-server`
deletes the estate and leaves the server running. Deleting from the page cannot
terminate the server, since Lore holds no key to a cloud account: the dialog
says so and gives the command.

A project that is the home of an estate cannot be deleted, and cannot turn Apps
off: other projects may deploy onto its estates, and nobody could manage them
any more. Its danger zone and its Apps switch name the estates in the way; move
or delete them first.

## The console of a Bay estate

Clicking a Bay estate on the Estates page opens its console, with four tabs:

| Tab      | What it shows                                                                    |
| -------- | -------------------------------------------------------------------------------- |
| Overview | What the machine is: whether it is online, when it last reported, and its usage. |
| Apps     | What runs on it, against what Lore expected, with **Restart** and **Stop**.      |
| Commands | What Lore has asked it to do, and how each went.                                 |
| Settings | The estate's own settings.                                                       |

Every member of the estate's home project can open its console and look: what
runs on it, the commands sent to it, its CPU and memory. That is what a plain
Member gets. Acting on it (a restart, a switch, a rotation, a log tail) takes
`estate:update`, which the project's owner holds and a rank can grant; nobody
reads a log without the permission to act.

A member of a project that only borrows the estate does not see the machine:
they see that it exists and whether it is up.

## Who is told

When a Cloudflare token stops working, or a throwaway estate is past its expiry,
every member of the estate's home project whose rank grants `estate:update` is
told, the project's owner among them: the people who can fix it. See
[Notifications](/lore/docs/guides-notifications).

## For an instance admin

The admin area's **Estates** page lists every estate of the instance, with its
home project, who created it, and the projects it is lent to. An admin can
delete one, and assign one a home: **Assign to project** offers the projects it
is lent to first. Assigning touches no loan, and the admin still reads no
credential.

An estate can have **no home**. Nobody but an admin can open it, it keeps
deploying through its loans, and it is still tied to the account of the person
who created it: deleting that account deletes the estate, and the account
deletion dialog says so. Assigning it a home ends both.

### Upgrading an instance

Upgrading to a Lore that homes estates in projects gives each existing estate a
home where the person who managed it keeps managing it: a project with Apps on
that this person owns, preferring one the estate is already lent to. An estate
that was lent only to a project its creator does not own comes out of the
upgrade with **no home**. It keeps deploying, and nobody but an admin can open
it until it is assigned.

So after the upgrade, once: open the admin area's **Estates** page, filter on
**No home**, and assign each estate listed, normally to the project it is lent
to (`lore estate assign <estate id> --to <project>` does the same from a
shell). That project's owner then manages it.

## Agents and estates

No MCP tool creates, moves, assigns or deletes an estate, on purpose: those
stay a person's acts. An agent deploys a copy it names by app and environment,
and the copy already knows its estate, so no deploy tool takes a machine.
`app_instance_update` can point a copy at an estate lent to the project
(`estateId`), `estate_stats` reads an estate's CPU and memory, and an agent
never sees an estate's secret.
