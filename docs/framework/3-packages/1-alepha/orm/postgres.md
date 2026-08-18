# Alepha - Orm Postgres

## Installation

Part of the `alepha` package. Import from `alepha/orm/postgres`.

```bash
npm install alepha
```

## Overview

PostgreSQL drivers for the Alepha ORM.

Selected automatically from the `DATABASE_URL` prefix: `postgres://`
(Node/Bun), `pglite://` (embedded), `hyperdrive://` (Cloudflare Workers).

## API Reference

### Providers

- [`BunPostgresProvider`](/docs/reference-providers-bunpostgresprovider) — Bun PostgreSQL provider using Drizzle ORM with Bun's native SQL client.
- [`CloudflareHyperdriveProvider`](/docs/reference-providers-cloudflarehyperdriveprovider) — Cloudflare Hyperdrive PostgreSQL provider using Drizzle ORM.
