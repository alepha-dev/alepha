# Deploying an app

Lore can deploy your app for you. You lend it a cloud account, tell it which
copies of your app exist, and then shipping is one command or one button.

This page is the whole story, from an empty project to a rollback.

## What Lore adds, and what it does not replace

Alepha already deploys. `alepha platform up -e production` reads your
`alepha.config.ts`, finds the environment declared there, and ships to it using
credentials on the machine running the command. That is the **static** path: the
environments are a list in a file you commit, and it works with no Lore account
at all.

**Lore is the dynamic half.** An environment is a row rather than a declaration,
so a copy that did not exist when the build was made can be deployed to without
a rebuild. That is what makes a preview environment per branch, or a tenant per
customer, expressible at all.

You do not need Lore to deploy an Alepha app, and you never will. If your
environments are a short fixed list and the credentials live on your CI runner,
`alepha platform` is the simpler answer and it is not going anywhere. Reach for
Lore when the list stops being fixed.

## The pieces

| Thing            | What it is                                                                             |
| ---------------- | -------------------------------------------------------------------------------------- |
| **Estate**       | A cloud account you own and lend to a project. Yours, not the project's.               |
| **App instance** | One deployed copy, named by a pair: an app and an environment. `club` in `production`. |
| **Artifact**     | A build somebody pushed, named by a tag. Immutable, except `latest`.                   |
| **Deployment**   | One run of "put these bytes on that copy", with its log.                               |

## 1. Turn deploys on

A project's settings have four capabilities. Open **Settings → Apps** and turn
on **Deploy apps**.

If you had already lent an estate to this project before deploys existed, the
switch is already on: an owner who lent a cloud account was not asked to go
looking for a second switch.

## 2. Lend an estate

Open **Settings → Estates** and add one. A Cloudflare estate needs an account id
and an API token, and Lore checks the token against that account before the
estate exists - see [The Cloudflare token](/lore/docs/guides-cloudflare-token) for which
permissions it needs and why the obvious template is not the right one.

An estate belongs to **you**, not to the project. Lending it to a project lets
that project deploy into it; withdrawing the loan stops that, and Lore refuses
to withdraw one while a copy still points at it.

## 3. Name the copy

Open **Apps** and create one. You type two names - the app and the environment -
and nothing else happens: no credential is minted, no cloud resource is created.
The row is a statement that this copy exists.

Both halves are free slugs. `production`, `staging`, `b14-production`,
`eu-staging` and `pr-1841` are all legal, so you slice a fleet as finely as you
want to.

Then open that copy's **Settings** tab and choose the estate it deploys to.
Doing so is what makes its **Deploy** and **Environment** tabs appear.

### Telemetry wires itself

If your app bundles the reporting module, you do not have to do anything: the
build says so in its manifest, and a deploy mints the copy's sigil and writes
`SIGIL_KEY` straight into that copy's environment. The token is never in your
terminal and never in a response.

```bash
lore deploy                # a sigil appears, if the build asks
lore deploy --no-sigil     # it does not
lore deploy --sigil        # it does, even for a silent build
```

⚠️ **Only a fresh sigil can be stored.** A sigil is kept as a hash, so Lore
holds the token for the moment it mints it and never again. A copy that already
has one and no `SIGIL_KEY` cannot be given one: rotate the sigil, or set
`SIGIL_KEY` yourself. The automatic path leaves such a copy alone and deploys
anyway; `--sigil` says so instead, because you asked.

## 4. Set what it runs with

The **Environment** tab holds the variables this copy runs with. They are
encrypted before they are stored, and **no screen and no endpoint ever shows one
again** - not to a member, not to you. Changing a variable means setting it
again.

Two families of name are refused, and the refusal says so:

- `DATABASE_URL`, `R2_BUCKET_NAME` and the `CLOUDFLARE_*` names. The deploy
  creates those resources and derives these from the ids it gets back, so a
  value stored here would be overwritten - or worse, would win, and point a
  fresh deploy at somebody else's database.
- Framework knobs the platform sets itself, like `LOG_LEVEL`.

### Two you do not have to set

A deploy fills these in when the copy has no value of its own, and an explicit
value always wins:

- **`APP_SECRET`** is minted on the first deploy that finds none, and stored
  like any other variable. Every Alepha app refuses to boot in production
  without it, and that refusal would otherwise land after the database and the
  bucket are already created, as a 500 from a deploy that reported success.
  ⚠️ It is minted **once** and read on every deploy after. Rotating it signs
  out every session and makes anything the app sealed with it unreadable, so a
  copy replacing an existing deployment should set its own before the first
  deploy rather than take a new one.
- **`PUBLIC_URL`** is derived from the copy's address, so absolute links in
  emails, OAuth callbacks and the sitemap resolve. Set it yourself for a copy
  answering on some other host, such as one behind a proxy.

## 5. Push a build

Builds come from the machine holding the source, because Lore cannot run Vite.

```bash
lore apps build --tag 1.2.3
lore artifacts push --tag 1.2.3
```

The first produces the bytes; the second stores them against your project. Both
read `LORE_API_KEY` from the environment and take `--project <slug>` (or
`LORE_PROJECT`) to say which project.

⚠️ `latest` is the default tag and the **only** one whose bytes may be replaced.
Two copies both showing `latest` may be running different code. Name a real tag
for anything you intend to promote.

## 6. Deploy it

From a terminal:

```bash
lore deploy
```

With no `--tag`, that builds, pushes and deploys, in that order. It is the inner
loop, where rebuilding is exactly what you want.

⚠️ **No `--env` either, when the app has one copy.** The command asks Lore which
copies of this app exist: one, and it takes it. Several, and it refuses rather
than guessing, naming them - `docs has production, preview. Pass --env <name>.`
An explicit `--env` or `LORE_ENV` always wins over that.

`lore apps deploy` is the same command spelled longer, and keeps working.

```bash
lore deploy --env production --tag 1.2.3
```

With a tag, it deploys the **stored** build and **never** builds one. If no
artifact carries that tag, the command refuses rather than making one.

That difference is the whole reason the registry exists. CI pushed `1.2.3` on
Tuesday from a clean checkout, it passed staging, and on Friday it is promoted.
Rebuilding at that moment produces different bytes, from a different machine,
with a different `node_modules` and a different git state, shipped under a name
that claims to be the thing that was tested.

Or from the **Deploy** tab, which lists what has been pushed for this app and
puts a button on each one. Or from an agent, with the `deploy_start` tool.

None of the three names a cloud account. You name a project, an app and an
environment; Lore resolves the rest from the copy's own row. That is deliberate
and it is not a convenience: a client that could name its own estate could
deploy into somebody else's cloud account.

## 7. Watch it

The Deploy tab follows a run and prints its log while it happens. `lore apps
deploy` streams the same log to your terminal and exits non-zero if the run
fails, so it works in CI. An agent polls `deploy_status`.

The log lives on the deployment row rather than in a buffer somewhere, so
closing the tab does not lose it and neither does a restart.

## 8. Take it down

Deleting a copy in Lore stops Lore tracking it. It does **not** delete the
Worker, the database or the bucket its deploys created - that is its own
command, because destroying a database is not something to infer from a
tidy-up:

```bash
lore apps destroy --env staging --confirm my-app/staging
```

⚠️ **Both flags are required and neither has a default.** `--env` does not fall
back to `LORE_ENV`, and it does not take the app's only environment the way
`lore deploy` does: on a command that deletes things, a forgotten flag would
mean destroying production without the word appearing anywhere. And the confirmation
is typed rather than composed, so naming the wrong environment fails the check
instead of confirming itself. There is no `--yes`.

### Copies that are meant to be thrown away

A copy created with **ephemeral** set says, before it holds anything, that its
data goes when it does - so a destroy takes its database and its bucket too.
That is what a preview per branch or a tenant per test wants.

⚠️ **It is settable only when the copy is created**, in the create dialog, on
`app_instance_create`, or as `ephemeral: true` from `@alepha/lore/client`.
There is no way to turn it on later, deliberately: a flag that could be flipped
would be flipped on the copy somebody wants to tidy away, which is exactly the
copy whose database matters.

⚠️ It permits, it does not schedule. Nothing sweeps ephemeral copies and none
of them expires; the flag only says what a destroy you ask for is allowed to
take.

For every other copy:

⚠️ **The database, the bucket and any Durable Object storage are kept.** Lore
removes what a redeploy puts back - the Worker, the queue, the cache namespace -
and never what it cannot: a D1 database and an R2 bucket are what the app was
serving, and Cloudflare offers no rename and no archive to soften deleting one.

An app that uses websockets also runs a Durable Object namespace, and that one
**is** removed with the Worker. It is not the same kind of thing as a database:
the namespace holds live connections and nothing else - Alepha's websocket
Durable Object persists no state - so deleting the Worker drops what would have
been dropped anyway.

That is also what makes this reversible. Resources are looked up by name, so a
copy destroyed and recreated under the same name **reattaches its own database
with every row still in it**. Deleting those two is `alepha platform down`,
which runs on your machine against your own account.

⚠️ **Lore deletes only what it recorded creating.** The names are derived from
the project, the app and the environment, so they are reproducible - and your
estate holds resources Lore never made, one of which could bear the same name.
A copy deployed before Lore started recording has nothing to act on and is
refused.

If a run removes some and fails on others, what went is struck from the record,
so running it again retries only the rest.

Deleting the copy itself is refused while any of this is still standing, since
that row is the only place their names are written. Pass `forget` when you have
already removed them by hand.

## 9. Roll back

Every successful run offers **Roll back**.

Cloudflare keeps every Worker version it has been sent, so the usual rollback
points the copy at an older version: seconds, no upload, and it works even if
you only ever push `latest`. When that version is gone - or the copy's estate
has changed - Lore redeploys the stored build instead, and says which it did.

⚠️ **A rollback changes the code and not the database.** If migrations have been
applied since the version you are going back to, the confirmation says how many,
and you have to acknowledge it. Old code against a new schema is the failure
that warning exists for.

## When a deploy is refused

Every refusal names the thing that is missing rather than a status code, because
the person running the command is often not the person who can fix it.

| It says                                          | What to do                                                   |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `… has no estate`                                | Choose one on the copy's Settings tab.                       |
| `… is no longer lent to this project`            | Ask its owner to lend it again.                              |
| `… does not accept deploys`                      | Its owner turns that on from their Estates page.             |
| `… does not have a usable Cloudflare credential` | Its owner checks the token from their Estates page.          |
| `… has no artifact tagged '…'`                   | Push one, or deploy a tag that exists.                       |
| `… has no \`workerd\` build`                     | Build for that runtime: the message names the exact command. |

The last one is the one worth understanding. An artifact is identified by its
app, its tag **and its runtime**, so `1.2.3` built for Cloudflare and `1.2.3`
built for a Bay machine are two stored builds rather than a collision. A deploy
looks up the one the estate can run, and a miss says which build to produce.
