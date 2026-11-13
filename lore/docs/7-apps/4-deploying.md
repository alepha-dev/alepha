# Deploying an app

Lore can deploy your app for you. You lend it a machine running Bay or a
Cloudflare account, tell it which copies of your app exist, and then shipping is
one command or one button. This page goes from an empty project to a rollback.

Deploying an app through Lore needs an app built with Alepha: what Lore ships
is the output of `alepha build`. For anything else,
[Stacks](/lore/docs/apps-stacks) deploy any Compose file.

## Do you need Lore to deploy?

No. `alepha deploy -e production` deploys an Alepha app with no Lore account:
it reads the environments declared in your `alepha.config.ts` and uses the
credentials on the machine running the command. That suits a short, fixed list
of environments deployed from CI.

Deploy through Lore when the list is not fixed. In Lore an environment is
something you create, so a copy that did not exist when the build was made can
be deployed to without a rebuild: a preview per branch, or a copy per customer.

## The pieces

| Thing            | What it is                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| **Estate**       | A Bay machine or Cloudflare account. It belongs to a project and is lent to the ones that deploy onto it. |
| **App instance** | One deployed copy, named by a pair: an app and an environment. `my-app` in `production`.                  |
| **Artifact**     | A build somebody pushed, named by a tag. It never changes, except under the tag `latest`.                 |
| **Deployment**   | One run of "put this build on that copy", with its log.                                                   |

See [Apps and instances](/lore/docs/apps-instances),
[Estates](/lore/docs/apps-estates) and [Artifacts](/lore/docs/apps-artifacts).

A new app can start on this path. `npm create alepha my-app -- --infra lore`
(or `alepha init --infra lore`) sets the project in `alepha.config.ts`, adds
`@alepha/lore`, wires telemetry, and links the directory to the project when
you are signed in. After that, adding an estate and running `alepha deploy`
(production by default, `-e` for another environment) is the whole loop.

## 1. Turn deploys on

Turn on **Deploy and watch apps** in **Settings ▸ General ▸ Capabilities**,
then open **Settings ▸ Apps** and turn on **Deploy apps**. See
[Capabilities](/lore/docs/project-capabilities).

Creating a copy needs the `app:manage` permission. Deploying, rolling back and
changing what a copy runs with need `deploy:manage`. The owner holds both, and
a [rank](/lore/docs/project-members) can be given them.

## 2. Add or borrow an estate

Open **Settings ▸ Apps ▸ Estates** and choose **Add an estate**. The estate
belongs to this project and is lent to it. An estate another project lends to
yours appears on the same page.

A Cloudflare estate needs an account id and an API token, and Lore checks the
token against that account before the estate exists. See
[The Cloudflare token](/lore/docs/apps-cloudflare-token) for the permissions it
needs. Everything else about estates, lending included, is in
[Estates](/lore/docs/apps-estates).

## 3. Create the copy

1. Open **Apps** and choose **New app**.
2. Type the app and the environment. Both are free names: `production`,
   `staging`, `eu-staging` and `pr-1841` are all fine, so you slice a fleet as
   finely as you want.
3. Open the copy's **Settings** tab and pick its estate under **Deploys to**.
   Only estates lent to the project are offered.

Creating the copy creates nothing in your cloud account. Choosing its estate
is what makes its **Deploy** and **Environment** tabs appear.

The estate is always chosen in Lore, never in `alepha.config.ts`. A first
`alepha deploy` that creates the copy itself uses the one estate lent to the
project, and refuses when several are lent, naming them.

### The name it gets in your estate

A copy's first deploy names everything it creates `<project>-<app>-<env>`,
such as `acme-shop-production`: on Cloudflare the Worker, the D1 database, the
bucket, the cache namespace and the queue, and on a Bay machine the instance,
its directory and its default subdomain. The copy's **Overview** tab shows the
name under **Resources**.

⚠️ **That name is fixed on the first deploy and never changes.** Cloudflare
cannot rename a database, so a name that followed the project would create an
empty one beside the live one. Renaming the project, the app or the
environment afterwards moves nothing: `acme-shop-production` keeps its name
under a project now called `shop`, and only copies deployed for the first time
after the rename take the new one. A destroy keeps the name too, so a copy
deployed again comes back to its own database.

On a **Bay** machine, the machine builds the instance name from the app and
the environment it is sent. A deploy is refused when the copy does not exist
in Lore or points at another estate. A copy whose app or environment was
renamed after its first Bay deploy is refused too, instead of being started
again as a new, empty instance: rename it back.

### Telemetry wires itself

If the app includes the reporting module (see
[Telemetry](/lore/docs/apps-telemetry)), there is nothing to set up. A deploy
creates the copy's sigil and writes `SIGIL_KEY` straight into the copy's
environment. The token never appears in your terminal.

```bash
lore deploy                # a sigil is created, if the build reports
lore deploy --no-sigil     # none is created
lore deploy --sigil        # one is created, even for a build that does not report
```

⚠️ **Only a fresh sigil can be stored.** Lore holds a sigil's token for the
moment it creates it and never again. A copy that already has a sigil and no
`SIGIL_KEY` cannot be given one: rotate the sigil, or set `SIGIL_KEY`
yourself. Without a flag, the deploy leaves such a copy alone and goes ahead.
With `--sigil`, it tells you.

## 4. Set what it runs with

The copy's **Environment** tab holds the variables it runs with. **Add
variable** sets one, and **Import .env** takes a pasted or dropped `.env`
file. A copy holds at most 100 variables.

Each row is one of two kinds:

- A **Variable** is a name the app declares as not secret. Its value is shown,
  and **Edit** changes it.
- A **Secret** is everything else. It is encrypted before it is stored and
  **never shown again**, to anyone: the tab shows at most its first
  characters. **Replace** sets a new value.

Three families of name are refused, and the refusal says so:

- `R2_BUCKET_NAME` and the `CLOUDFLARE_*` names. The deploy creates those
  resources and derives the values itself. A value stored here could point a
  fresh deploy at somebody else's bucket. `DATABASE_URL` is the one exception
  on Cloudflare, and only for a Postgres URL: see
  [D1 or Postgres](#d1-or-postgres).
- Settings the platform sets itself, like `LOG_LEVEL`.
- On a copy that runs on a **Bay** (one deploying to a Bay estate, or a
  stack's app service), the names Bay writes into every instance:
  `APP_SECRET`, `APP_NAME`, `NODE_ENV`, `DATABASE_URL`, `DATA_DIR`,
  `STORAGE_PATH`, `SERVER_HOST`, `SERVER_PORT` and the `S3_*` names.

### Three you do not have to set

A deploy fills these in when the copy has no value of its own. A value you set
always wins.

- **`APP_SECRET`** is created on the first deploy that finds none, and stored
  like any other secret. An Alepha app refuses to start in production without
  it. ⚠️ It is created **once** and reused on every deploy after. Changing it
  signs out every session and makes anything the app sealed with it
  unreadable, so a copy replacing an existing deployment should set its own
  before the first deploy.
- **`PUBLIC_URL`** is derived from the copy's address, so absolute links in
  emails, OAuth callbacks and the sitemap resolve. Set it yourself for a copy
  answering on some other host, such as one behind a proxy.
- **`APP_NAME`** is set to the copy's resource name, `<project>-<app>-<env>`,
  and stored like `APP_SECRET`. It names the copy in its own logs, and the
  app also uses it to prefix the session cookie, the cache keys and, when
  `S3_KEY_PREFIX` is unset, the keys of the copy's bucket. A name the app
  declares in code wins too. ⚠️ A copy first deployed without this default
  gets it on its next deploy: its users are signed out once, and files it
  stored under its old prefix are not moved. Set `APP_NAME` (or
  `S3_KEY_PREFIX`) yourself before that deploy to keep the old names.

### `APP_SECRET` on a Bay

On a Bay copy, the machine owns the key. Bay creates it and sends it to Lore,
so the `APP_SECRET` row always holds the key the copy runs on, and the tab
says it was **set by the machine**. A Bay host rebuilt from scratch, or a copy
moved onto a Bay estate, takes that key back on its first deploy, so nobody is
signed out. If the row held another key, the machine's replaces it and the
deploy's log says so. The same holds for a stack's app service.

A copy moved onto a Bay estate keeps the variables it already had. Those among
them that Bay writes itself stay listed and are not sent to the machine, so
moving the copy back finds them where they were.

⚠️ **A copy keeps its key when it moves between estates**, in either
direction. The estate it left, and that machine's backups on a Bay, still hold
the key it runs on: whoever controls them can sign sessions for it. After
moving a copy off a machine you do not control, change its key: with
`bay secret replace` on its new Bay, or by setting `APP_SECRET` on this tab
for a copy now on Cloudflare. Either one signs every session out and loses
what was sealed with the old key, such as MFA enrolments.

### D1 or Postgres

On Cloudflare, each copy chooses its own database, and the build does not
change. With no `DATABASE_URL`, the deploy creates a D1 database for the copy.
Set `DATABASE_URL` to a Postgres URL and the copy runs on that server through
Cloudflare Hyperdrive instead:

```bash
DATABASE_URL=postgres://app:secret@db.example.com:5432/app_prod?sslmode=require \
  lore secrets set DATABASE_URL --env production
```

So one build can run `staging` on D1 and `production` on Postgres. The
**Environment** tab says which database the copy runs on, naming the
Postgres server and database, never the password.

- **The URL is a secret, never sent to the app.** The deploy hands it to
  Hyperdrive and to the migrations only; the Worker sees `hyperdrive://`.
- **Each deploy migrates first.** The build's `migrations/postgres/` is applied
  to the server before the new version ships. A build pushed before the app
  kept that folder is refused, and nothing is created: run
  `alepha db baseline create --provider postgres`, push a new build and deploy
  that one.
- **A rotated password needs only a redeploy.** Set the new URL, deploy: the
  Hyperdrive config is updated on every run.
- **Two copies cannot share one database.** Lore refuses a `DATABASE_URL`
  naming the host, port and database another copy already uses: both would
  apply their migrations to one set of tables.
- **The server needs a publicly trusted certificate** on a DNS name, and the
  estate's token needs **Hyperdrive: Edit** (see
  [The Cloudflare token](/lore/docs/apps-cloudflare-token)).
- **Backups are yours.** D1 has Time Travel; a Postgres server is backed up
  by whoever runs it.

⚠️ **Switching moves no data.** Setting `DATABASE_URL` on a copy that ran on
D1, or removing it from one on Postgres, points the next deploy at the other
database as it stands: empty, the first time. The old database is kept, so
switching back finds it again; a move to Postgres says so in the deploy's
log. Copying rows across is yours to do.

## 5. Push a build

Builds come from the machine holding the source: your laptop or your CI.

```bash
lore apps build --tag 1.2.3
lore artifacts push --tag 1.2.3
```

The first builds the app, the second stores the build in your project. Both
take `--project <slug>` (or `LORE_PROJECT`), and sign in with `lore login` or
with `LORE_API_KEY` in CI. See [Artifacts](/lore/docs/apps-artifacts).

⚠️ `latest` is the default tag and the **only** one whose build may be
replaced. Two copies both showing `latest` may be running different code. Name
a real tag for anything you intend to promote.

## 6. Deploy it

**From the browser.** The copy's **Deploy** tab lists what has been pushed for
this app, with a **Deploy** button on each build. A build's own page, under
**Artifacts**, has a **Deploy** menu listing every copy that can run it.

**From a terminal**, there are two ways:

```bash
lore deploy
```

With no `--tag`, this builds, pushes and deploys, in that order. It is the
loop for everyday work, where rebuilding is what you want.

```bash
lore deploy --env production --tag 1.2.3
```

With a tag, it deploys the **stored** build and **never** builds one. If no
artifact carries that tag, the command refuses. This is how you promote
exactly what was tested: the build CI pushed on Tuesday and staging ran is the
one that reaches production on Friday, not a rebuild from another machine.

⚠️ **`--env` is optional only when the app has one copy.** The command asks
Lore which copies of this app exist. With one, it takes it. With several, it
refuses and names them: `docs has production, preview. Pass --env <name>.`
An explicit `--env` or `LORE_ENV` always wins.

`lore apps deploy` is the same command.

No way of deploying names a cloud account. You name a project, an app and an
environment, and Lore finds the estate from the copy itself.

## 7. Watch it

The **Deploy** tab follows a run and prints its log while it happens. Closing
the tab does not lose the log: open **Log** on the run later. `lore deploy`
streams the same log to your terminal and exits non-zero if the run fails, so
it works in CI.

## 8. Roll back

Every successful run on the **Deploy** tab offers **Roll back**.

Cloudflare keeps every Worker version it has been sent, so the usual rollback
points the copy at an older version: seconds, no upload, and it works even if
you only ever push `latest`. When that version is gone, or the copy's estate
has changed, Lore redeploys the stored build instead. The confirmation says
which of the two it will do.

⚠️ **A rollback changes the code and not the database.** The old code will
run against the current schema, so Lore checks whether it fits. Every
`lore artifacts push` sends the newest Drizzle `snapshot.json` of each
dialect under `migrations/`, and Lore compares the schema the old build
expects with the one every later deploy left behind:

| Since that build                                           | The rollback                       |
| ---------------------------------------------------------- | ---------------------------------- |
| tables, nullable or defaulted columns, plain indexes added | goes through, no acknowledgement   |
| a table or column dropped or renamed                       | names it: the old build will break |
| a `NOT NULL` column added with no default                  | names it: the old build will break |
| a column type changed, a constraint or unique index added  | names it: some writes may fail     |

A rollback across a database switch never brings the old database back:
the fast path is refused, because an older Worker version is bound to the
database it ran on, and Lore redeploys the stored build against the database
the copy runs on today. The confirmation says so.

Anything it names has to be acknowledged. A data migration (an `UPDATE` that
changes no structure) leaves the snapshot as it was, so the check cannot see
it. When a build was pushed without its schema (an older CLI), the
confirmation falls back to saying how many migrations were applied since.

## 9. Take it down

Deleting a copy, from its **Settings** tab, removes Lore's record of it. It
does **not** remove what its deploys created. That is a command of its own:

```bash
lore apps destroy --env staging --confirm my-app/staging
```

⚠️ **Both flags are required and neither has a default.** `--env` does not
fall back to `LORE_ENV`, and it does not take the app's only environment the
way `lore deploy` does, so a forgotten flag can never destroy production. The
confirmation is the copy's own `app/env`, typed, so naming the wrong
environment fails the check. There is no `--yes`.

### On Cloudflare

The command removes what a redeploy puts back: the Worker, the job queue and
its dead-letter queue, the cache namespace, and the Hyperdrive config of a copy
that ran on Postgres. The Postgres server and its data are never touched. An app that uses websockets
also has a Durable Object namespace, which holds live connections and nothing
else. It goes with the Worker.

⚠️ **The database and the bucket are kept.** A D1 database and an R2 bucket
are what the app was serving, and Cloudflare offers no rename and no archive
to soften deleting one. Resources are found by name, so a copy destroyed and
deployed again under the same name **gets its own database back with every
row still in it**. To delete those two, run `alepha infra down` on your own
machine, against your own account.

### Copies that are meant to be thrown away

A copy created as **Ephemeral** says, before it holds anything, that its data
goes when it does. A destroy then takes its database and its bucket too. That
is what a preview per branch wants.

⚠️ **It can be set only when the copy is created**: with the **Ephemeral**
box of the **New copy** dialog on a build's page, with
`lore apps instance create --ephemeral`, or as `ephemeral: true` from
`@alepha/lore/client`. It cannot be turned on later, so nobody can flip it on
a copy whose database matters.

⚠️ It permits, it does not schedule. Nothing sweeps ephemeral copies and none
of them expires. The flag only says what a destroy you ask for may take.

### On a Bay

The same command asks the machine to remove the copy. Bay stops serving it and
unregisters it, and **its database, uploads and `.env` stay on the machine**,
so a deploy of the same copy brings it back. The estate must accept deploys,
and the command waits for the machine to say it is done. Lore keeps the copy
until you delete it with `lore apps instance delete`, which it refuses while
the machine still runs the copy.

⚠️ **Lore never asks a machine to delete data.** `--purge` sends nothing: it
prints the `bay remove --purge` command to run on the machine, which removes
the copy and its data together.

### What a destroy will not touch

⚠️ **Lore deletes only what it recorded creating.** The names are derived from
the project, the app and the environment, and your estate may hold resources
Lore never made, one of which could bear the same name. A copy with nothing
recorded is refused.

If a run removes some resources and fails on others, what went is struck from
the record, so running it again retries only the rest.

Deleting the copy itself is refused while any of its resources is still
standing, since the copy is the only place their names are written. Only the
API's `forget` option overrides that, for resources you have already removed
by hand.

## When a deploy is refused

Every refusal names what is missing, because the person running the command is
often not the person who can fix it.

| It says                                                      | What to do                                                                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `… has no estate`                                            | Choose one on the copy's Settings tab.                                                                                 |
| `Several estates are lent to this project …`                 | Create the copy with `lore apps instance create --estate <slug>`, or choose its estate on the Apps page, then deploy.  |
| `lore() takes no estate …`                                   | Remove `estate` from `alepha.config.ts`; the copy's estate is set in Lore.                                             |
| `… is no longer lent to this project`                        | Ask its home project to lend it again.                                                                                 |
| `… does not accept deploys`                                  | Somebody with `estate:update` in its home project turns that on from its console.                                      |
| `… does not have a usable Cloudflare credential`             | Somebody with `estate:update` in its home project checks the token from its console.                                   |
| `… has no artifact tagged '…'`                               | Push one, or deploy a tag that exists.                                                                                 |
| `… has no \`workerd\` build`                                 | Build for that runtime: the message names the exact command.                                                           |
| `Another copy in this Cloudflare account is already named …` | Another copy already uses that name: point this copy at another estate, or rename the project before its first deploy. |
| `Another copy on this Bay machine is already named …`        | The same, on one Bay machine.                                                                                          |
| `… has no copy named …`                                      | Create the copy on the Apps page and choose this estate on its Settings tab.                                           |
| `… was first deployed to this machine as …`                  | Rename the copy's app or environment back to the names it was deployed under.                                          |

About the missing build: an artifact is identified by its app, its tag **and
its runtime**, so `1.2.3` built for Cloudflare and `1.2.3` built for a Bay
machine are two stored builds, not a collision. A deploy looks up the one the
estate can run.

## From the command line

Beyond the commands above:

```bash
lore apps instance create --app my-app --env production --estate my-vps
lore secrets set --file .env.production --env production
lore deploy status --app my-app --env production
lore deploy rollback --deployment <id>
```

The full list is in [The lore CLI](/lore/docs/reference-cli).

## From an agent

An agent deploys a stored build with `deploy_start`, follows it with
`deploy_status` and goes back with `deploy_rollback`. It never builds.
`app_instance_create` creates a copy, and is the one tool that can mark it
ephemeral. See [MCP tools](/lore/docs/reference-mcp-tools).

## Next

- [Estates](/lore/docs/apps-estates)
- [Artifacts](/lore/docs/apps-artifacts)
- [Telemetry](/lore/docs/apps-telemetry)
- [Stacks](/lore/docs/apps-stacks)
