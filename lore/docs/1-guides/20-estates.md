# Estates

An estate is a place Lore deploys to: a machine running Bay, or a Cloudflare
account. It belongs to you, not to a project, and you lend it to the projects
that may deploy onto it. This page explains the two kinds, how to add one, and
how a project and its apps come to use it.

## Two kinds

| Kind           | What it is                                                      | How Lore reaches it                                                                                                    |
| -------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Bay**        | A server of yours running [Bay](/bay/docs/guides-introduction). | Bay dials out to Lore over a websocket, with a secret Lore minted. Nothing on the machine needs an open port for Lore. |
| **Cloudflare** | A Cloudflare account, where apps run as Workers.                | Lore calls Cloudflare's API with a token you minted and the account id.                                                |

Both are owned by a user. Deleting your account deletes your estates, and any
app copy that pointed at one is left with no estate.

## Adding an estate

Your estates live on the **Estates** page of your account, under **Lore**
(`/account/estates`). It lists every estate you own, across every project.

### A Bay estate

Create the estate on the Estates page, from a project's **Settings ▸ Apps ▸
Estates** (which also lends it to that project), or from a project directory
with the CLI:

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
ssh root@my-vps "curl -sSL https://alepha.dev/bay/install.sh | LORE_URL=https://lore.alepha.dev LORE_ESTATE_SECRET=$SECRET sh"
lore estate wait my-vps
```

⚠️ The secret is shown **once**. Lore keeps only a hash of it, so it cannot
show it again; if you lose it, rotate the estate to mint a new one
(`lore estate rotate my-vps`, or the console) and run the command again. The
old secret stops working the moment you rotate.

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
state it saw. `lore estate get my-vps` reads the same estate once, with what the
machine reports running; a machine that never connected says so. See
[The Lore connector](/bay/docs/guides-lore-connector) in the Bay documentation
for the machine's side.

### A Cloudflare estate

Paste an API token and your 32-character account id into the creation dialog.
Lore checks the token against the account before it creates anything, and again
every night. Which token to mint, and with which permissions, is the whole of
[The Cloudflare token](/lore/docs/guides-cloudflare-token).

## Accepting deploys

A new Bay estate does **not** accept deploys. Turn **Allow deploys** on when you
are ready, on the **Settings** tab of its
[console](#the-console-of-a-bay-estate), or pass `--allow-deploys` to
`lore estate add`. A Cloudflare estate accepts deploys from creation, and the
same switch turns them off. From a shell, `lore estate update my-vps
--allow-deploys` (or `--no-allow-deploys`) does the same, and `--label` renames
it.

The console's **Settings** tab also has:

- **Rotate secret**, to replace the estate's secret;
- **Keep a history of CPU and memory** and **Stats interval**, for the machine's
  stats;
- the projects it is lent to, each with **Detach**;
- **Delete**.

A Cloudflare estate has no console: clicking it on the Estates page opens a
drawer with **Allow deploys** and:

- **Replace token**, to paste a new token over the old one;
- **Check again**, to ask Cloudflare now rather than at the nightly check;
- the projects it is lent to, each with **Detach**;
- **Delete**.

A token that has expired or that Cloudflare refuses shows as
**credential invalid**, and deploys are refused until you replace it.

## Lending an estate to a project

An estate does nothing for a project until it is lent to it. Lend it from the
project's **Settings ▸ Apps ▸ Estates**, where you can pick one you own or
create a new one; `lore estate add` lends the estate it creates to the current
project. `lore estate list` shows the estates a project
can use, and whether each is connected.

Withdrawing a loan is refused while an app copy of that project still deploys
onto the estate: move or delete that copy first.

Then each app copy picks its estate on its own **Settings** tab, or an agent
sets it with `app_instance_update`. A deploy never asks you which machine: it
goes where the copy says. See [Deploying an app](/lore/docs/guides-deploying). A
stack names its estate itself: `lore stack create --estate` sets its default,
and `lore stack deploy --estate` overrides that on an environment's first
deploy.

## A throwaway estate

A server bought for a test keeps billing until somebody deletes it. Give its
estate a time to live and Lore says when it is overdue:

```bash
lore estate add tmp-vps --allow-deploys --ttl 2h --output json
lore estate update tmp-vps --ttl 1d    # extend, from now
lore estate update tmp-vps --ttl none  # keep it
```

`--ttl` takes a number and `m`, `h` or `d`. Past the expiry the estate shows
**overdue** on the Estates page and in `lore estate list`, and you are told once,
in the header bell and by email (category Estates). Extending or clearing the TTL
re-arms that. Lore stops nothing and deletes nothing: deleting the estate and the
server stays your call.

## Deleting an estate

Delete an estate from its console's **Settings** tab, the Cloudflare drawer, or
a shell:

```bash
lore estate delete my-vps --yes
```

The slug is one of the estates you own: `lore estate delete` never acts on an
estate someone else lent to the project. Without `--yes` it asks first, and with
no terminal to ask on it refuses rather than wait. `--output json` prints
`{ ok, id, slug, revoked }` for a script.

Deleting is refused while an app copy, a stack or a stack environment, in any
project, still deploys onto the estate; the refusal names each one. Repoint or
remove them first.

Nothing on the machine stops: Lore forgets the connection, and for a Bay estate
the secret is revoked, so the connector holding it is refused on its next dial.
A server bought for a test is deleted with its provider afterwards.

## The console of a Bay estate

Clicking a Bay estate on the Estates page opens its console, with four tabs:

| Tab      | What it shows                                                                    |
| -------- | -------------------------------------------------------------------------------- |
| Overview | What the machine is: whether it is online, when it last reported, and its usage. |
| Apps     | What runs on it, against what Lore expected, with **Restart** and **Stop**.      |
| Commands | What Lore has asked it to do, and how each went.                                 |
| Settings | The estate's own settings.                                                       |

The console is for the estate's owner only: a project member who deploys onto
your estate does not see your machine.

## Agents and estates

There is no MCP tool for estates, on purpose. An agent deploys a copy it names
by app and environment, and the copy already knows its estate, so no deploy tool
takes a machine. `app_instance_update` can point a copy at an estate lent to the
project (`estateId`), and an agent never sees an estate's secret.
