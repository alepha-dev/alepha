# Introduction

Lore is an open-source project management app built on Alepha.

Projects hold **quests** (the roadmap and the in-flight work), **epics** (bounded
initiatives that hold quests and run one way from planned to done, see
[Epics](/lore/docs/guides-epics)), **folios** (project memory, wiki-linked and
optionally end-to-end encrypted), **feedback** (inbound bug and feature triage),
**blights** (deduplicated crash telemetry reported by the apps you deploy), **releases**
(the named goals epics and quests ship in) and **reports** (analytics and insights
over all of it).

Every one of those surfaces is exposed over **MCP**, which is the primary consumer:
an AI agent reads the folio index to orient itself, drives quests as work lands, and
files what it learned back as a folio.

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
