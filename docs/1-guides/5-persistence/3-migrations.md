# Migrations

Alepha manages database schema migrations through the embedded Drizzle Kit. The behavior differs between development, testing, and production environments.

## Development Mode

In development, `alepha dev` automatically synchronizes your entity schemas to the database. No manual migration steps are needed.

```bash
alepha dev
```

When the application starts, `DrizzleKitProvider.synchronize()` introspects the actual database state, diffs it against your current entity definitions, and applies the changes. There are no stored snapshots — no drift, no corruption; the database itself is the source of truth.

This means you can change entity schemas freely during development. The framework detects differences and applies them on startup.

## Testing Mode

In test environments, `synchronize()` generates the schema from scratch and executes it, so tests always start with a clean, up-to-date schema. (`CREATE SCHEMA` statements are rewritten to `CREATE SCHEMA IF NOT EXISTS` so repeated runs are safe.)

## Production Mode

In production, `synchronize()` does nothing. You must handle migrations explicitly with migration files.

### Generate Migrations

Use the Alepha CLI to generate migration files from your entity schemas:

```bash
alepha db migrations create
```

This explores your application metadata, collects all registered entities, and invokes Drizzle Kit's migration generator. Files are written to `migrations/<provider>/` (e.g. `migrations/postgres/`).

### Check for Drift

```bash
alepha db migrations check
```

Fails if your entity schemas have changed since the last migration was generated — `alepha verify` runs this automatically when a `migrations/` directory exists, so a forgotten migration fails CI instead of production.

### Apply Migrations

Apply generated migrations to the database:

```bash
alepha db migrations apply
```

### Environment Selection

Use the `--mode` flag to specify which `.env` file to load for the database connection:

```bash
alepha db migrations create --mode production
alepha db migrations apply --mode production
```

This loads `.env.production` for the `DATABASE_URL` and other environment variables.

### More Database Commands

The full command surface — `alepha db push [--dry-run]` for prototyping without migration files, `alepha db baseline create/mark` for collapsing migration history, and `alepha db studio` for a database browser — is documented in the [Db Command](/docs/cli-commands-db) reference.

## Multi-Instance Safety

When running multiple application instances (e.g., behind a load balancer), use `alepha/lock` with a Redis-backed lock provider to ensure only one instance runs migrations at a time. Without this, concurrent migration execution can cause conflicts.

## Cloudflare D1 (SQLite)

For Cloudflare Workers using D1, migrations run against the deployed database before your code ships. If you deploy with the [platform plugin](/docs/cli-plugins-platform), `alepha p up` handles this for you (via `wrangler d1 migrations apply`); to run them alone, use `alepha p db migrate`.

## Database URL Configuration

The database driver is selected based on the `DATABASE_URL` environment variable:

| URL Prefix        | Driver |
|-------------------|--------|
| `postgres://`     | PostgreSQL (Node.js or Bun, selected automatically) |
| `pglite://`       | PGlite (embedded PostgreSQL) |
| `hyperdrive://`   | Cloudflare Hyperdrive (Postgres from Workers) |
| `d1://`           | Cloudflare D1 |
| Other / no prefix | SQLite (Node.js or Bun, selected automatically) |

## Workflow Summary

```bash
# Development - automatic schema sync
alepha dev

# Production - explicit migration workflow
alepha db migrations create                   # generate migration files
alepha db migrations check                    # CI: fail on schema drift
alepha db migrations apply --mode production  # apply to production database
```
