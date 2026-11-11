# Getting started

This page takes you from no account to a project with members, the `lore`
command on your machine and an AI agent connected over MCP, then files a first
quest. Each step links to the page that covers it in depth.

## 1. Pick an instance

There are two ways to run Lore, and everything below works the same on both:

- **The hosted instance**, [lore.alepha.dev](https://lore.alepha.dev). Register
  from its sign-in page and you are done.
- **Your own**, from the `ghcr.io/alepha-dev/lore` image. One command, one
  volume; the first account to register becomes the administrator. See
  [Self-hosting](/lore/docs/guides-self-hosting).

On your own instance, replace `https://lore.alepha.dev` with your address
everywhere on this page.

## 2. Create a project

Open **New project** (`/new-project`). A project has a name, a slug that becomes
its address (`https://lore.alepha.dev/<slug>`) and a set of **capabilities**:

| Capability                   | What it turns on                                                     |
| ---------------------------- | -------------------------------------------------------------------- |
| **Plan and track work**      | Quests, areas, and optionally epics, releases, a board, automations. |
| **Write and keep knowledge** | Folios: wiki-linked notes in a tree, with files and revisions.       |
| **Deploy and watch apps**    | App instances, their analytics, vitals and errors, deploys.          |
| **Collect feedback**         | A request form for any signed-in Lore account, and a triage inbox.   |

The wizard asks for at least one. You can change your mind later in
**Settings ▸ General ▸ Capabilities**: turning one off hides its pages and
refuses writes to it, but deletes nothing, so turning it back on brings
everything back.

Slugs are unique on the instance, and renaming a project frees its old slug for
someone else to take.

## 3. Invite your team

Open **Settings ▸ Members** and invite people. They find the invitation on their
**Invitations** page (`/account/invitations`) once they have an account.

A new project has two ranks, **Owner** and **Member**. If you need finer access,
create more from **Settings ▸ Ranks** (Admin, Contributor and Viewer are offered
as starting points). A few things stay with the owner whatever ranks you create:
deleting the project and switching its capabilities. Ownership is transferred,
never shared.

What someone can do is the intersection of three things: what the instance
lets their account do, what their rank grants in this project, and which
capabilities the project has on. A rank cannot reach into a capability that is
off.

The project's [estates](/lore/docs/guides-estates), the machines it deploys to,
follow the same rule: a Member can look at them, and the owner, or a rank such
as Admin, can change, add, move or delete them.

## 4. Install the command line

The `lore` command drives a project from a terminal or a CI job. It needs
Node.js.

```bash
npm i -g @alepha/lore
lore login
```

`lore login` prints an address and a code: open the address in a browser where
you are signed in to Lore, enter the code and approve. From then on the
machine stays signed in: the session refreshes itself, and ends after 30 days
without a command (180 days at most) or when you revoke it. `lore logout`
forgets it.

To sign in to your own instance, export `LORE_URL` first. Every `lore` command
reads it, so keep it set in the shell you work from:

```bash
export LORE_URL=https://lore.example.com
lore login
```

Then tie your working copy to the project, so you do not have to name it on
every command:

```bash
cd my-app
lore project link my-project
lore quest list
```

`lore project link` writes `.alepha/lore.json`, which every later command finds
by walking up from the current directory. In CI there is nobody to approve a
code, so use an API key instead (`LORE_API_KEY`, see below). The full command
list is in [The lore CLI](/lore/docs/guides-cli).

## 5. Connect an AI agent

Lore is built to be driven by agents, and MCP is how they reach it. The server
lives at:

```text
https://lore.alepha.dev/mcp
```

It speaks MCP over streamable HTTP and authenticates with **OAuth**, including
dynamic client registration, so a client that supports remote MCP servers needs
nothing but the URL. On first use it sends you to a Lore consent page; approve
it and the agent works as you. With Claude Code, for example:

```bash
claude mcp add --transport http lore https://lore.alepha.dev/mcp
```

You can see and revoke every connection you granted on **Connected apps**
(`/account/connections`). [MCP tools](/lore/docs/guides-mcp) lists what an agent
can call.

A connection made this way reaches what a project member can do, and nothing
else: no admin pages, no API keys, no account settings, even if you are an
administrator yourself.

### With an API key

Some clients, and every CI job, cannot go through a browser. For them, create
an **API key** on **API keys** (`/account/keys`). Keys start with `ak_`.
Send one as a bearer token:

```http
Authorization: Bearer ak_...
```

The `lore` command reads it from `LORE_API_KEY`:

```bash
export LORE_API_KEY=ak_...
lore project info -p my-project
```

⚠️ An API key is not narrowed the way an OAuth connection is: it carries all of
your roles, admin ones included, unless you gave it a narrower permission scope
when you created it. Prefer OAuth for agents on your own machine, and a scoped
key for CI.

## 6. File a first quest

A **quest** is one piece of work. From the web, open **Quests** and create one.
From a terminal:

```bash
lore quest create --title "Add a dark mode toggle" --area web --priority medium
```

From an agent, just ask: "file a quest to add a dark mode toggle". A
well-behaved agent starts with `project_context`, which returns the project's
capabilities, its areas, your active quests and the folio index in one call,
then reuses an existing area rather than inventing one, and calls
`quest_create`.

Every quest gets a number per project, written `#Q12`. Put it in your commit
messages and record the commits on the quest; [Quests](/lore/docs/guides-quests)
describes the whole loop.

## Where to go next

- [Quests](/lore/docs/guides-quests): statuses, areas, the board, and the
  agent workflow.
- [Folios](/lore/docs/guides-folios): the project's memory, for people and
  agents.
- [Epics](/lore/docs/guides-epics) and [Releases](/lore/docs/guides-releases):
  grouping quests into initiatives and versions.
- [Telemetry](/lore/docs/guides-telemetry): connecting a running app.
- [Deploying an app](/lore/docs/guides-deploying): shipping from Lore.
