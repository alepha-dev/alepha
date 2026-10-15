# Migrations

Alepha manages database schema migrations through the embedded Drizzle Kit. The behavior differs between development, testing, and production environments.

## Development Mode

In development, `alepha dev` automatically synchronizes your entity schemas to the database. No manual migration steps are needed.

```bash
alepha dev
```

When the application starts, `DrizzleKitProvider.synchronize()` introspects the actual database state, diffs it against your current entity definitions, and applies the changes. There are no stored snapshots - no drift, no corruption; the database itself is the source of truth.

A column that is both added and removed on one table (or a table added while another is removed) looks like a rename to drizzle-kit, and its rename prompt needs a terminal that `alepha dev` does not have. The sync resolves it the way a development push means: the columns and tables your entities no longer declare are dropped, each one named in a warning, and the push runs again on a diff that only adds. The rows survive; the dropped columns' data does not.

When the push cannot run at all, the sync falls back to creating the tables that are missing and touches nothing else. It then logs the schema as `INCOMPLETE` rather than `OK`, naming how many tables it left as they were: entity changes on those tables have not reached the database. Delete the development database (`node_modules/.alepha/sqlite.db` by default) and start again, or write a migration.

This means you can change entity schemas freely during development. The framework detects differences and applies them on startup. Set `DATABASE_SYNC=false` to skip the sync (when you manage the schema yourself).

## Testing Mode

In test environments, `synchronize()` generates the schema from scratch and executes it, so tests always start with a clean, up-to-date schema. (`CREATE SCHEMA` statements are rewritten to `CREATE SCHEMA IF NOT EXISTS` so repeated runs are safe.)

## Production Mode

In production nothing is pushed: the schema only changes through migration files. On startup the app applies the pending files from `migrations/<provider>/` itself (on PostgreSQL under a `$lock`, see below). Two exceptions:

- **Serverless** runtimes (Cloudflare Workers and the like) never migrate at boot: migrations are applied at deploy time.
- **No migrations folder** while the app declares entities is a startup error, not a warning, because the first query would otherwise fail on a missing table. `DATABASE_SYNC=false` opts out, for a schema managed outside the app.

A folder still in drizzle-kit's pre-v1 layout (`meta/_journal.json`) is refused at startup too: run `alepha db baseline create`, then `alepha db baseline mark`.

### Generate Migrations

Use the Alepha CLI to generate migration files from your entity schemas:

```bash
alepha db migrations create
```

This explores your application metadata, collects all registered entities, and invokes Drizzle Kit's migration generator. Files are written to `migrations/<provider>/` (e.g. `migrations/postgres/`).

Flags: `--name <name>` names the file, `--custom` writes an empty migration for hand-written SQL (a data migration), `--provider <name>` targets one provider when the app has several, and `--hints '<json>'` answers drizzle-kit's rename-or-create questions non-interactively (drizzle-kit exits with code 2 and prints the JSON it needs).

### Check for Drift

```bash
alepha db migrations check
```

Fails if your entity schemas have changed since the last migration was generated (a project with entities and no migration yet counts as drift), or if any migration on disk holds an unexcused `DROP TABLE` (see [Cloudflare D1](#cloudflare-d1-sqlite)). `alepha verify` runs this unconditionally (it returns cleanly when the app has no database), so a forgotten migration fails CI instead of production.

### Apply Migrations

Apply generated migrations to the database:

```bash
alepha db migrations apply
```

It boots the app in production mode with `MIGRATE=true`, which applies the migrations of every provider and exits (it takes no `--provider`). A built app does the same with `MIGRATE=true node dist/index.<runtime>.js` (or `MODE=MIGRATE`).

### Environment Selection

Use the `--mode` flag to specify which `.env` file to load for the database connection:

```bash
alepha db migrations create --mode production
alepha db migrations apply --mode production
```

This loads `.env.production` for the `DATABASE_URL` and other environment variables.

### More Database Commands

The full command surface - `alepha db push [--dry-run]` for prototyping without migration files, `alepha db baseline create/mark` for collapsing migration history, `alepha db studio` for a database browser, and `alepha db doctor [--print]` to find SQLite rows whose stored type disagrees with their column - is documented in the [Db Command](/docs/cli-commands-db) reference.

## Multi-Instance Safety

On PostgreSQL, the startup migration runs under a Postgres advisory lock (`pg_advisory_lock`), one per schema, held on a connection of its own. When several instances boot at once (e.g. a rolling deploy behind a load balancer), the first migrates and the others wait for it, then find the migrations applied. No Redis is needed: the database is the one thing the instances share. The wait is bounded at 5 minutes, after which the boot fails with a `DbMigrationError` naming the lock. The SQLite drivers take no lock.

## Cloudflare D1 (SQLite)

For Cloudflare Workers using D1, migrations run against the deployed database before your code ships. If you deploy with the [infra plugin](/docs/cli-plugins-infra), `alepha deploy` handles this for you; to run them alone, use `alepha infra db migrate`.

Under the hood each migration file is applied through D1's import flow (what `wrangler d1 execute --file` uses) - deliberately **not** `wrangler d1 migrations apply`, which wraps each migration in a transaction where SQLite ignores `PRAGMA foreign_keys=OFF`, so a table rebuild cascade-deletes child rows. Applied files are still recorded in wrangler's `d1_migrations` table.

The same hazard is why `alepha db migrations create` refuses a migration containing a bare `DROP TABLE` (the generated file is left on disk for you to read): on D1, dropping a table that CASCADE children reference silently wipes those child rows. If the drop is not intended, delete the file and restructure the change (rename + copy, or drop the children first). If it is, record why in a comment on the line directly above the statement:

```sql
-- alepha-allow-drop-table: rebuild of a table nothing references
DROP TABLE `old_table`;
```

`alepha db migrations check` re-reads every migration on every run, so a drop without that marker fails CI even after the file was kept.

## Database URL Configuration

The database driver is selected based on the `DATABASE_URL` environment variable:

| URL Prefix        | Driver                                              | Module              |
| ----------------- | --------------------------------------------------- | ------------------- |
| `postgres://`     | PostgreSQL (Node.js or Bun, selected automatically) | `AlephaOrmPostgres` |
| `pglite://`       | PGlite (embedded PostgreSQL)                        | `AlephaOrmPostgres` |
| `hyperdrive://`   | Cloudflare Hyperdrive (Postgres from Workers)       | `AlephaOrmPostgres` |
| `d1://`           | Cloudflare D1                                       | `AlephaOrm`         |
| Other / no prefix | SQLite (Node.js or Bun, selected automatically)     | `AlephaOrm`         |

`AlephaOrm` is registered by any `$entity`, and only knows the SQLite drivers: a `postgres://` URL with it alone fails with "Postgres URL is not supported for SQLite provider". The PostgreSQL drivers come with `AlephaOrmPostgres`, which you register yourself:

```typescript
import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";

const alepha = Alepha.create().with(AlephaOrmPostgres);
```

PostgreSQL also reads `POSTGRES_SCHEMA` (default `public`), `POOL_MAX`, and `POOL_IDLE_TIMEOUT` / `POOL_CONNECT_TIMEOUT` in seconds. The D1 settings (`DATABASE_TIMEOUT`, `DATABASE_D1_MODE`) are covered in the [Cloudflare guide](/docs/guides-deployment-cloudflare).

Unset, SQLite uses an in-memory database under test and on serverless, and otherwise writes to `node_modules/.alepha/sqlite.db` - a development scratch
file that needs no configuration and is removed along with the rest of
`node_modules`.

**`DATABASE_URL` is required in production**, and the app refuses to start
without it. That scratch path is not a place data can live: `npm ci` deletes it,
nothing backs it up, and `alepha dev` has already pushed your schema into it with
an empty migrations journal - so a production boot on the same file would try to
apply the baseline over tables that already exist and fail on the first
`CREATE TABLE`. Point it somewhere outside the bundle
(`sqlite:///var/lib/myapp/db.sqlite`) or at a `postgres://` URL.

## Workflow Summary

```bash
# Development - automatic schema sync
alepha dev

# Production - explicit migration workflow
alepha db migrations create                   # generate migration files
alepha db migrations check                    # CI: fail on schema drift
alepha db migrations apply --mode production  # apply to production database
                                              # (or let the app apply them at startup)
```
