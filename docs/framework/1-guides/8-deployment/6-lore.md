# Deploying through Lore

Every other page in this section describes the **static** path: `alepha platform
up -e production` reads `alepha.config.ts`, finds the environment declared
there, and ships to it under credentials on the machine running the command. The
environments are a list you commit, and the whole chain runs offline apart from
the cloud provider itself.

[Lore](https://lore.alepha.dev) is the **dynamic** half. An environment becomes
a row rather than a declaration, the credential lives in Lore rather than on
your laptop, and a copy that did not exist when the build was made can be
deployed to without a rebuild.

⚠️ **Lore is not required to deploy an Alepha app, and it must never become
so.** If your environments are a short fixed list and your credentials live on
a CI runner, `alepha platform` is the simpler answer and it is not going
anywhere. Reach for Lore when the list stops being fixed: a preview environment
per branch, or one copy per customer, is not a thing a committed file expresses
well.

## The binary

`lore` ships in `@alepha/lore` and is a separate binary from `alepha`.

```bash
npm i -g "@alepha/lore"
lore login
```

It authenticates with `LORE_API_KEY` in CI, and `--project <slug>` (or
`LORE_PROJECT`) says which project a command is about.

## Build and push

```bash
lore apps build --tag 1.2.3
lore artifacts push --tag 1.2.3
```

`lore apps build` runs the real `alepha build` as a subprocess, once per target,
and does not reimplement any of it. There is no second build path to drift from
the first, because there is no second build path.

Two flags decide what it produces:

- `--target cloudflare,bare` builds each named target. With neither flag, it
  builds whatever the local `alepha.config.ts` declares - and does it offline,
  with no network at all.
- `--env staging` builds "whatever that environment can run", resolved through
  the estate behind it. Naming both flags at once is a refusal rather than a
  precedence question, when they disagree: an environment already decides what
  it can run, so asking for a `docker` build of an environment that runs on
  Cloudflare is asking for two different things.

⚠️ `--env` on `build` selects a **target** and never reaches a value inside the
bytes. It must not: a value frozen into a stored artifact breaks promotion,
which is the whole reason a registry exists. Two environments on one estate type
produce byte-identical output, and a test exists to keep that true.

`lore artifacts push` packs `dist/` and stores it. It reads the runtime out of
the build's own `dist/manifest.json` rather than from a flag, so an artifact is
identified by `(project, app, tag, runtime)` - `1.2.3` built for Cloudflare and
`1.2.3` built for a Bay machine are two stored builds rather than a collision.

## Deploy

```bash
lore apps deploy --env production
```

With no tag: build, push, deploy, stopping on the first failure. The inner loop.

```bash
lore apps deploy --env production --tag 1.2.3
```

With a tag: deploy the **stored** artifact. It never builds, and it refuses when
no artifact carries that tag rather than quietly making one.

⚠️ **The tag is the switch, and it is the rule to know before running the
command.** An unconditional cascade would make the artifact registry decorative.
CI pushed `1.2.3` on Tuesday from a clean checkout, it passed staging, and on
Friday it is promoted; rebuilding at that moment produces different bytes, from
a different machine, with a different `node_modules` and a different git state,
shipped under a name that claims to be the thing that was tested.

⚠️ `--env` on `deploy` names the **instance**, not a target. So the zero-flag
command builds environment-independent bytes and then places them at an
environment. It reads as an inconsistency with `lore apps build --env` until you
know that one selects a build axis and the other a deploy axis.

Omitting `--tag` deploys `latest`, which is the one tag whose bytes may be
replaced in place. Two copies both showing `latest` may be running different
code.

The command follows the run, streams its log to the terminal, and exits non-zero
when the run fails - so it works as a CI step.

### There is no `--estate`

You name a project, an app and an environment. Lore resolves the destination
from the copy's own row.

That is structural rather than a convenience: a client that could name its own
estate could deploy into somebody else's cloud account. The same rule holds for
the web UI and for the MCP tools, so no surface anywhere accepts one.

### An environment that does not exist is refused

`lore apps deploy --env prod` against a project whose copy is called
`production` says so and names where to create one. It does not create it.
Minting a deploy target as a side effect of a typo is how a fleet grows a copy
nobody meant to make.

## From another server

An app whose environments have a lifecycle of their own - one copy per tenant,
per branch, per customer - drives Lore programmatically rather than through a
pipeline. `@alepha/lore/client` is that seam.

```ts
import { AlephaLoreClient, LoreDeployService } from "@alepha/lore/client";

const alepha = Alepha.create().with(AlephaLoreClient);
const lore = alepha.inject(LoreDeployService);

// A club owner signs up with the slug "wassup":
const { url } = await lore.deploy({
  app: "club",
  env: "wassup",
  tag: "latest",
  create: true,
  url: "https://wassup.club.example",
});
```

Configured by the same three variables as CI - `LORE_URL`, `LORE_API_KEY`,
`LORE_PROJECT` - so one deployment configures both halves. The key's user needs
`app:manage` to create a copy and `deploy:manage` to ship to one.

⚠️ **`create: true` is opt-in, and off by default.** A missing copy is normally
a refusal, for the reason above: minting a deploy target as a side effect of a
typo in `env` is how a fleet grows a copy nobody meant to make. Pass it where
making one IS the act being performed.

A copy created this way **inherits the estate** of the app's `production` copy
(or the first by name), so the call carries no infrastructure at all. Pass
`estate` with a slug to override, and it is resolved against the estates lent
to this project rather than trusted.

⚠️ **The `url` is what makes the answer a URL.** The deploy takes the domain
from the copy's own address and the adapter answers a URL only when it put one
into effect, so a copy created with no address deploys perfectly well and
answers nothing to link to.

⚠️ **It does not build.** `lore apps build` and `lore artifacts push` belong in
CI, on the machine holding the source; this ships bytes that already exist and
refuses when the tag names none.

## From an agent

Three MCP tools sit on the same endpoints: `deploy_start`, `deploy_status` and
`deploy_rollback`, over the instance an agent already names with
`app_instance_list`. There is no estate tool, for the reason above.

## Rollback

Cloudflare keeps every Worker version it has been sent, so the usual rollback
points a copy at an older version: seconds, no artifact fetch, no upload, and it
works even under `latest`-only retention. When that version is gone, Lore
redeploys the stored artifact instead and says which path it took.

⚠️ A rollback changes the code and not the database. When migrations have landed
since the version you are going back to, both the UI and the tool refuse once
and name how many.

## Secrets

A deploy target that exists only as a row has no `.env.<env>` on anybody's
machine, so Lore holds the variables. They are encrypted at rest and no read
path ever returns one, to anybody.

They go up **with** the script, in the same upload, rather than after it.
`alepha platform up` runs `deploy` then `secrets` in that order only because
`wrangler secret put` needs the worker to exist first, and that ordering leaves
a window in which the new build runs against the previous secret set. Lore does
the upload itself, so the window does not exist - first deploy included.

`DATABASE_URL`, `R2_BUCKET_NAME` and the `CLOUDFLARE_*` names are refused by
name: the deploy provisions those resources and derives the values from the ids
it gets back, so a value stored under one of them would be overwritten, or would
win and point a fresh deploy at somebody else's database.

## Where to read next

The end-to-end story from an empty project - lending an estate, naming a copy,
deploying and rolling back - is in Lore's own documentation at
[Deploying an app](/lore/docs/guides-deploying).
