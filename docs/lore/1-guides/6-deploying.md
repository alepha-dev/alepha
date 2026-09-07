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

### Giving it a sigil at the same time

A copy can be created with its telemetry already wired:

```bash
lore apps deploy --env production --sigil
```

Lore mints the sigil and writes `SIGIL_KEY` straight into that copy's
environment, so the app reports without anybody pasting a credential. The token
is never in your terminal and never in a response.

⚠️ **Only a fresh sigil can be stored this way.** A sigil is kept as a hash, so
Lore holds the token for the moment it mints it and never again. A copy that
already has a sigil and no `SIGIL_KEY` cannot be given one: rotate the sigil, or
set `SIGIL_KEY` yourself. Running `--sigil` on a copy that already reports does
nothing, so it is safe to leave in a CI command.

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
lore apps deploy --env production
```

With no `--tag`, that builds, pushes and deploys, in that order. It is the inner
loop, where rebuilding is exactly what you want.

```bash
lore apps deploy --env production --tag 1.2.3
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

## 8. Roll back

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
