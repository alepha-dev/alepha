# Migrations

Alepha manages database schema migrations through Drizzle Kit. The behavior differs between development, testing, and production environments.

## Development Mode

In development, `alepha dev` automatically synchronizes your entity schemas to the database. No manual migration steps are needed.

```bash
alepha dev
```

When the application starts, `DrizzleKitProvider.synchronize()` compares the current entity schemas against a stored snapshot and generates migration statements. These are executed automatically. The schema snapshot is stored in:

- **PostgreSQL**: The `drizzle.__drizzle_dev_migrations` table.
- **SQLite**: A local file at `node_modules/.alepha/sqlite-<app>-<provider>.json`.

This means you can change entity schemas freely during development. The framework detects differences and applies them on startup.

## Testing Mode

In test environments, `synchronize()` generates migration statements from scratch (no prior snapshot) and executes them. This ensures tests always start with a clean, up-to-date schema.

The framework skips `DROP SCHEMA` statements during execution to prevent accidental data loss.

## Production Mode

In production, `synchronize()` does nothing. You must handle migrations explicitly.

### Generate Migrations

Use the Alepha CLI to generate migration files from your entity schemas:

```bash
alepha db generate
```

This explores your application metadata, collects all registered entities, and invokes Drizzle Kit's migration generator.

### Apply Migrations

Apply generated migrations to the database:

```bash
alepha db migrate
```

### Environment Selection

Use the `--mode` flag to specify which `.env` file to load for the database connection:

```bash
alepha db generate --mode production
alepha db migrate --mode production
```

This loads `.env.production` for the `DATABASE_URL` and other environment variables.

## Multi-Instance Safety

When running multiple application instances (e.g., behind a load balancer), use `alepha/lock` with a Redis-backed lock provider to ensure only one instance runs migrations at a time. Without this, concurrent migration execution can cause conflicts.

## Cloudflare D1 (SQLite)

For Cloudflare Workers using D1, migrations must be applied manually before deploy since there is no persistent connection during cold start:

```bash
alepha db generate
wrangler d1 migrations apply <db-name> --local   # local dev
wrangler d1 migrations apply <db-name> --remote   # production
```

## Database URL Configuration

The database driver is selected based on the `DATABASE_URL` environment variable:

| URL Prefix | Driver |
|------------|--------|
| `postgres://` | PostgreSQL (Node.js or Bun, selected automatically) |
| `pglite://` | PGlite (embedded PostgreSQL) |
| `d1://` | Cloudflare D1 |
| Other / no prefix | SQLite (Node.js or Bun, selected automatically) |

## Workflow Summary

```bash
# Development - automatic schema sync
alepha dev

# Production - explicit migration workflow
alepha db generate              # generate migration files
alepha db migrate --mode production  # apply to production database

# Cloudflare D1
alepha db generate
wrangler d1 migrations apply my-db --remote
```
