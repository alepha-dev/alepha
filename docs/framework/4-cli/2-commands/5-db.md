# Db Command

Manage your database schema from the CLI. The `db` command generates migrations from your `$entity` definitions, checks for drift, applies migrations, and opens a database browser — all powered by the embedded drizzle-kit.

## Quick Start

```bash
# After changing an $entity schema
alepha db migrations create

# Apply pending migrations
alepha db migrations apply
```

Migrations are written to `migrations/<provider>/` — one directory per database provider (e.g. `migrations/postgres/`, `migrations/sqlite/`).

## Common Flags

All subcommands accept:

| Flag | Description |
|------|-------------|
| `--provider` | Target a single database provider by name (e.g. `postgres`, `sqlite`). Default: all providers with repositories. |

## Commands

### migrations check

Compare the last migration snapshot against your current `$entity` schemas. Fails (exit code 1) if the schema has drifted, printing the SQL statements a new migration would contain.

```bash
alepha db migrations check
```

Drift is reported across **all** providers before failing, so a clean Postgres never masks a drifted SQLite migration set. This is the check that `alepha verify` always runs — it returns cleanly when the app has no database.

Alias: `alepha db m check`.

### migrations create

Generate migration files from the current schema.

```bash
alepha db migrations create
alepha db migrations create --name add-user-avatar
alepha db migrations create --custom          # empty migration for hand-written SQL
```

| Flag | Description |
|------|-------------|
| `--name` | Name for the generated migration file |
| `--custom` | Generate an empty migration file for custom SQL (data migrations, manual adjustments) |
| `--hints` | JSON array of drizzle-kit hints resolving ambiguous diffs (rename-vs-create). When a hint is required, drizzle-kit exits with code 2 and prints the exact JSON to pass — without it, a table rename becomes CREATE+DROP, which is data loss |

### migrations apply

Apply pending migrations to the database. Boots your app in production mode with `MIGRATE=true`, so migrations run through the same code path as a deployed app.

```bash
alepha db migrations apply
```

For a *deployed* database (Cloudflare D1, Hyperdrive), use `alepha platform db migrate` instead — it resolves the environment, adapter, and resource naming.

### push

Push schema changes directly to the database, skipping migration files. Useful for rapid prototyping — not for production databases.

```bash
alepha db push
alepha db push --dry-run     # preview the SQL without executing
```

`--dry-run` prints every statement that would run and warns loudly when a change would cause data loss.

### baseline

Collapse a long migration history into a single baseline migration.

```bash
# Archive existing migrations into .archive/ and generate one baseline migration
alepha db baseline create

# On a database that already has the schema: record the baseline as applied
# without executing it
alepha db baseline mark
```

`baseline create` moves the existing migration files into `migrations/<provider>/.archive/` and generates a fresh `baseline` migration from the current schema. Databases that already ran the old history then use `baseline mark` so the new baseline is bookkept as applied rather than re-executed.

> **Cloudflare D1**
>
> `alepha db baseline mark` does not support D1 — its deploy path uses wrangler's filename-based bookkeeping table. Use `alepha platform db baseline mark` instead.

### studio

Launch [Drizzle Studio](https://orm.drizzle.team/drizzle-studio/overview), a browser UI for inspecting and editing your database.

```bash
alepha db studio
```

## Local vs Deployed

The `alepha db` commands operate on the database your app connects to locally (`DATABASE_URL`, or the default dev SQLite database). Operations against a *deployed* database live under the [platform plugin](/docs/cli-plugins-platform):

| Local | Deployed |
|-------|----------|
| `alepha db migrations apply` | `alepha p db migrate` |
| `alepha db baseline mark` | `alepha p db baseline mark` |
| — | `alepha p db export` (pull remote DB into a local snapshot) |

## Workflow

The migration-file workflow keeps your schema history in git:

```bash
# 1. Edit an $entity schema
# 2. Generate the migration
alepha db migrations create --name add-avatar

# 3. Inspect the generated SQL, then apply locally
alepha db migrations apply

# 4. Commit the migration files with the schema change
```

`alepha verify` runs `db migrations check` automatically, so forgotten migrations fail CI instead of failing in production.

## Tips

**Always inspect generated migrations.** Auto-generated SQL is usually right, but destructive statements (`DROP TABLE`, column type changes) deserve a human read before they reach a real database.

**Use `push --dry-run` to understand drift.** It shows exactly what SQL would reconcile your database with the schema, without running anything.

**Baseline before v1, not after.** Collapsing history is easiest while you control every environment that runs migrations.
