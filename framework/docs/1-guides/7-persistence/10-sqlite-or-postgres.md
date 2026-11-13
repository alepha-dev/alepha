# SQLite or Postgres

One code base runs on SQLite and on Postgres. Which one an app uses is decided by a single variable, `DATABASE_URL`, read when it starts. Nothing in the source changes, nothing is imported or registered differently, and the same build runs on either.

This page helps you choose, then shows what a switch looks like wherever the app runs: on Cloudflare, in Docker, and in your specs.

## Choosing

**SQLite is the default.** With no `DATABASE_URL`, development uses a file under `node_modules/.alepha/` and specs use an in-memory database, so a new app needs no server at all. In production it can be a file on a disk you keep (`sqlite:///var/lib/myapp/db.sqlite`), or Cloudflare D1, which is SQLite managed for you.

Stay on SQLite while:

- the app runs as **one instance**, or on Cloudflare Workers with D1;
- the data fits comfortably on one machine and its backups are a file copy (or D1's Time Travel);
- you want the shortest path from `alepha dev` to production.

Move to **Postgres** when:

- several instances must write to one database at once (a rolling deploy behind a load balancer, workers on other machines);
- you already run a Postgres server, with its backups, replicas and access rules;
- the data or the write load outgrows one SQLite file;
- another system reads or writes the same tables.

The switch is cheap in both directions because every app keeps migrations for both dialects from the start (see [Both migration folders](#both-migration-folders)). Data is not carried over by a switch: moving rows from one database to the other is yours to do.

## The URL decides

| `DATABASE_URL`                         | Database                                          |
| -------------------------------------- | ------------------------------------------------- |
| unset                                  | SQLite (a scratch file, or in memory)             |
| a path, `sqlite:`, `file:`, `:memory:` | SQLite                                            |
| `postgres://` or `postgresql://`       | Postgres                                          |
| `d1://`                                | Cloudflare D1 (written by the deploy)             |
| `hyperdrive://`                        | Postgres through Cloudflare Hyperdrive (the same) |

Any other scheme is refused at startup. The settings each driver reads are listed in [Database URL Configuration](/docs/guides-persistence-migrations#database-url-configuration). A production app refuses to start with no `DATABASE_URL`, so the scratch file can never hold real data.

## Both migration folders

Every app with entities keeps two folders side by side:

```
migrations/
  sqlite/     # SQLite and D1
  postgres/   # Postgres and Hyperdrive
```

`alepha db migrations create` writes one migration in **each** folder from the same entity change, whatever `DATABASE_URL` says, and `alepha db migrations check` fails when either folder has drifted. `--provider sqlite` or `--provider postgres` narrows a command to one. Neither command needs a database: the other dialect's model is built offline.

An app that only has `migrations/sqlite/` (it was created before both folders were the rule) gets one clear error from `check` and `create`. Add the Postgres history once, as a baseline of the current schema:

```bash
alepha db baseline create --provider postgres
```

### Custom SQL

`alepha db migrations create --custom` creates an empty migration in both folders, under the same name. Write each dialect's SQL in its own file. `check` compares the two and fails when one holds SQL and its twin is empty, since a data migration written for one dialect only would otherwise go unnoticed.

When the other dialect genuinely needs nothing, say why in either file:

```sql
-- alepha-sqlite-only: SQLite stored this flag as text; Postgres always had a boolean column
UPDATE `settings` SET `enabled` = 1 WHERE `enabled` = 'true';
```

`-- alepha-postgres-only: <why>` is the mirror image.

## On Cloudflare

With the [infra plugin](/docs/cli-plugins-infra), the environment's `.env.<env>` decides:

```bash
# .env.production: D1
# No DATABASE_URL. The deploy creates a D1 database and binds it.

# .env.production: Postgres through Hyperdrive
DATABASE_URL=postgres://app:secret@db.example.com:5432/app?sslmode=require
```

For a Postgres URL, `alepha deploy`:

1. creates (or updates) a Hyperdrive config named after the app and the environment, pointed at your server;
2. applies `migrations/postgres/` to the server itself, before the new code ships, under the same advisory lock and journal (`drizzle.migrations_<schema>`) a server instance uses;
3. uploads the Worker with the Hyperdrive binding. The URL itself is **never** uploaded as a Worker secret: the Worker only knows `hyperdrive://HYPERDRIVE`.

The URL is sent to Cloudflare again on **every** deploy, so a rotated password needs only the new value in `.env.<env>` and a redeploy. Hyperdrive keeps the sessions that already logged in, so the old password can seem to keep working until they close; the new one takes over within seconds of the deploy.

### What Cloudflare needs from your server

- **Reachable from the internet**, on the host and port the URL names.
- **A publicly trusted certificate on a DNS name.** A Worker cannot be given a custom CA, so a self-signed certificate, or one from a private CA, cannot be verified. A Let's Encrypt certificate on the server's own name works. Ask for TLS in the URL (`sslmode=require`, `verify-ca` or `verify-full`); the deploy carries it to Hyperdrive.
- **Hyperdrive caching stays off.** The deploy turns it off on every create and update: Hyperdrive does not invalidate a cached read when the app writes, so a page would read its own write back stale.
- **A token that can manage Hyperdrive** (**Hyperdrive: Edit**), on top of what a D1 deploy needs.

### Moving between D1 and Postgres

Adding or removing `DATABASE_URL` and deploying again moves the environment. The new database starts as it is: no row is copied, and the old one is kept, so moving back finds it where you left it. `alepha infra down` removes the Hyperdrive config with the rest.

## In Docker

A container reads `DATABASE_URL` like any server. For SQLite, keep the file on a volume, so a new image does not start from an empty database:

```bash
docker run -v myapp-data:/data -e DATABASE_URL=sqlite:///data/app.db myapp
```

For Postgres, point it at the server:

```bash
docker run -e DATABASE_URL=postgresql://app:secret@db:5432/app myapp
```

Either way, the app applies the pending migrations of the matching folder when it starts, under an advisory lock on Postgres, so several containers may start at once. The [Docker guide](/docs/guides-deployment-docker) shows how to bake these settings into the image.

## Backups

D1 has Time Travel: Cloudflare can restore a database to any minute of a recent window (30 days on a paid plan). **Postgres has no equivalent in Alepha**: on your own server, and behind Hyperdrive, backups are yours to run and to test. The same goes for a SQLite file on a disk.

## One database per environment

Two environments must not share one database. Every instance of an app migrates the same schema (`public` unless `POSTGRES_SCHEMA` says otherwise) and records it in one journal, so a staging deploy would apply its migrations to production's tables. Give each environment its own database, or at least its own `POSTGRES_SCHEMA`.

## Specs on Postgres

Specs run on in-memory SQLite by default. To run the whole suite on Postgres, point `POSTGRES_TEST_URL` at a server and pass `--dialect postgres`:

```bash
POSTGRES_TEST_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres alepha test --dialect postgres
```

Every spec that would have used SQLite (no `DATABASE_URL`, or an in-memory one) then runs on that server, in a schema of its own, created with the migrations and dropped when its container stops. A spec that names a SQLite file on purpose keeps it. To put a single spec on Postgres, register `AlephaOrmTestPostgres` from `alepha/orm`; see [Database Testing](/docs/guides-testing-unit-tests#database-testing).

In CI, run the suite once per dialect, against a Postgres service. Large schemas dropped in parallel can exhaust Postgres's default lock table: start the test server with `-c max_locks_per_transaction=1024` (and, in Docker, `--shm-size=1g`).

## What the ORM does not hide

The repository API is the same on both, and the [column types](/docs/guides-persistence-special-columns#column-types) map to the closest native type. Some differences still reach your code:

- **Dates.** Postgres stores `timestamptz`, SQLite stores epoch milliseconds. Raw date SQL is not portable: use [Portable SQL](/docs/guides-persistence-portable-sql).
- **Integer width.** `z.integer()` is a 32-bit `integer` on Postgres. A value past 2,147,483,647, such as a timestamp in milliseconds, needs `z.int64()`.
- **Raw SQL.** `PRAGMA`, `json_extract`, `typeof()` and `EXPLAIN QUERY PLAN` are SQLite only; `LIKE` on a `jsonb` or array column, and comparing a `uuid` column with text, need a cast on Postgres. The repository's own operators (`contains`, `ilike`, ...) work on both.
- **Counts.** A raw `count(*)` comes back as a string from Postgres. Wrap it in `Number()`, or use the repository's `count()`.
- **Transactions.** D1 has none: `$transactional()` runs its body in place there, and a failure halfway keeps the writes made before it. See [Without transactions, as on D1](/docs/guides-testing-unit-tests#without-transactions-as-on-d1).

The reliable way to find the rest is to [run your specs on Postgres](#specs-on-postgres).
