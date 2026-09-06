# Introduction

Lore is an open-source project management app built on Alepha.

A project is not one fixed shape. It is a container that composes four
**capabilities**, and you pick them when you create it:

- **Work** - **quests** (the roadmap and the in-flight work), **areas**, and
  optionally **epics** (bounded initiatives that hold quests and run one way
  from planned to done, see [Epics](/lore/docs/guides-epics)), **releases**
  (the named goals epics and quests ship in) and a Kanban **board**.
- **Knowledge** - **folios**: project memory, wiki-linked, optionally
  end-to-end encrypted, filed in a tree.
- **Apps** - the copies you deploy, the **sigils** they report with, their
  analytics, and **blights**: deduplicated crash telemetry.
- **Support** - **feedback**, inbound bug and feature triage, plus a
  first-party request form your users can reach.

Turn a capability off and its pages, its menu entries and its search results
go with it. Nothing is deleted: turn it back on and everything is where you
left it. A project can have all four or just one, and turning them all off is
allowed - what remains is the project itself, its members, its activity feed
and its reports.

**Reports** sits outside the four: every project has it, and each of its tabs
appears when the capability behind it does.

Every one of those surfaces is exposed over **MCP**, which is the primary consumer:
an AI agent reads the folio index to orient itself, drives quests as work lands, and
files what it learned back as a folio. `project_context` answers the capability
set first, then only the sections those capabilities own - a section a project
has turned off is absent rather than empty, so an agent is never told a project
tracks something it does not.

## Apps and their instances

An **app** is a name rather than a record. What Lore stores is one **instance**
per deployed copy: the pair `(app, env)`, so `club/production` and `club/staging`
are two instances of one app and nothing else has to exist for them to be. The
environment half is a free label, not a fixed list, so `b14-production` and
`eu-staging` are as valid as `staging`, and how finely you slice your fleet is
your decision rather than the schema's.

Creating an instance mints nothing. It records that a copy of your app runs
somewhere, and each capability is unlocked on it separately, from that instance's
**Settings** tab:

- a **sigil** is the credential the deployed copy reports with. Minting one
  unlocks Analytics, Vitals, Errors and Explore for that copy alone.
- an **estate** names the machine the copy is deployed to.

⚠️ **Removing a sigil destroys that instance's analytics history** - views,
vitals, unique visitors and error groups all hang off the credential. To revoke a
leaked token, rotate it instead: the app stops reporting with the old key
immediately and every row survives.

## Why it exists

Lore is the only public Alepha _product_ (the docs site and examples are public too, but they demo the framework rather than stand alone), and it lives in the framework's own
repository on purpose. It is where framework changes get used before they are
recommended: a rough edge in Alepha shows up in Lore first, and the fix ships in the
same commit as the feature that exposed it.

## Status

Lore is deployed at [lore.alepha.dev](https://lore.alepha.dev) and shares its version
number with the rest of the ecosystem.

It also ships as a self-hosted image, `ghcr.io/alepha-dev/lore`, published by the
same release that publishes the framework. One command, one volume, no
configuration:

```bash
docker run -p 3000:3000 -v lore:/data ghcr.io/alepha-dev/lore
```

See [Self-Hosting](/lore/docs/guides-self-hosting) for what happens on first boot and
what each optional variable buys.
