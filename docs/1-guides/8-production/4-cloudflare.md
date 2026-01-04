# Cloudflare Deployment

Cloudflare Workers run at the edge, milliseconds from your users. Cold starts are nearly instant. Perfect for global applications.

## Quick Start

```bash
npx alepha build --cloudflare
cd dist && npx wrangler deploy
```

## Project Setup

Here's a minimal `package.json`:

```json
{
  "scripts": {
    "dev": "alepha dev",
    "build": "alepha build --cloudflare",
    "deploy": "alepha build --cloudflare && wrangler deploy -c=dist/wrangler.jsonc"
  },
  "dependencies": {
    "alepha": "^0.13.0",
    "react": "^19.0.0"
  },
  "devDependencies": {
    "wrangler": "^4.0.0"
  }
}
```

## What Gets Generated

```
dist/
├── index.js              # Your bundled application
├── main.cloudflare.js    # Worker entry point
├── public/               # Static assets (served by Workers Sites)
└── wrangler.jsonc        # Wrangler configuration
```

## Custom Deploy Command

For complex deployments (migrations, environment loading), create an `alepha.config.ts`:

```typescript
import { $command } from "alepha/command";
import { loadEnv } from "vite";

export default () => ({
  deploy: $command({
    handler: async ({ run, root }) => {
      // Build for Cloudflare
      await run("npx alepha build --cloudflare");

      // Run database migrations
      await run("npx alepha db:migrate --mode=production");

      // Load Cloudflare credentials from .env.production
      Object.assign(process.env, loadEnv("production", root, "CLOUDFLARE"));

      // Deploy
      await run("npx wrangler deploy -c=dist/wrangler.jsonc");
    },
  }),
});
```

Now `npx alepha deploy` handles everything.

## Cloudflare D1 (SQLite at the Edge)

D1 is Cloudflare's serverless SQLite database. It runs at the edge, so your database is as fast as your workers.

### 1. Create a D1 database

```bash
npx wrangler d1 create my-database
# Note the database ID from the output
```

### 2. Set the connection string

```env
# .env.production
DATABASE_URL=cloudflare-d1://my-database:your-database-id
```

The format is `cloudflare-d1://binding-name:database-id`.

### 3. That's it

Alepha automatically:
- Detects the D1 connection string
- Configures the `d1_databases` binding in `wrangler.jsonc`
- Uses the D1 driver instead of PostgreSQL
- Runs your Drizzle migrations on deploy

Your entities and repositories work exactly the same:

```typescript
import { $entity, $repository, db } from "alepha/orm";

const userEntity = $entity({
  name: "users",
  schema: t.object({
    id: db.primaryKey(),
    email: t.email(),
    name: t.text(),
  }),
});

class Db {
  users = $repository(userEntity);
}

// Works on Postgres locally, D1 in production
const user = await db.users.create({ email: "hello@example.com", name: "Alice" });
```

## Wrangler Configuration

The generated `wrangler.jsonc` looks like:

```jsonc
{
  "name": "my-app",
  "main": "./main.cloudflare.js",
  "compatibility_flags": ["nodejs_compat"],
  "compatibility_date": "2025-11-17",
  "assets": {
    "directory": "./public",
    "binding": "ASSETS"
  },
  // Auto-generated if DATABASE_URL starts with cloudflare-d1://
  "d1_databases": [
    {
      "binding": "my-database",
      "database_name": "my-database",
      "database_id": "your-database-id"
    }
  ]
}
```

You can extend this in `vite.config.ts`:

```typescript
viteAlepha({
  cloudflare: {
    // Additional wrangler config
    vars: {
      STRIPE_PUBLIC_KEY: "pk_live_..."
    },
    kv_namespaces: [
      { binding: "CACHE", id: "your-kv-id" }
    ]
  }
})
```

## KV Storage

Use Cloudflare KV for caching:

```bash
# Create a KV namespace
npx wrangler kv:namespace create CACHE
```

Add to your config:

```typescript
viteAlepha({
  cloudflare: {
    kv_namespaces: [
      { binding: "CACHE", id: "your-kv-id" }
    ]
  }
})
```

## R2 Storage

For file uploads, use Cloudflare R2 (S3-compatible):

```bash
# Create R2 bucket
npx wrangler r2 bucket create uploads
```

Configure in your app:

```typescript
import { AlephaBucketS3 } from "@alepha/bucket-s3";

alepha.with(AlephaBucketS3);
```

```env
S3_ENDPOINT=https://account-id.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_REGION=auto
```

## Environment Variables

Set secrets via Wrangler:

```bash
npx wrangler secret put APP_SECRET
npx wrangler secret put DATABASE_URL
```

Or use `.dev.vars` for local development:

```env
# .dev.vars (gitignored)
APP_SECRET=dev-secret
DATABASE_URL=postgres://localhost:5432/dev
```

## Migrations

Run D1 migrations before deploying:

```bash
# Generate migration
npx alepha db:generate

# Apply locally
npx wrangler d1 execute my-database --local --file=drizzle/0001_migration.sql

# Apply to production
npx wrangler d1 execute my-database --file=drizzle/0001_migration.sql
```

## Deployment Commands

```bash
# Deploy to production
npx alepha build --cloudflare && cd dist && npx wrangler deploy

# Deploy to preview
npx alepha build --cloudflare && cd dist && npx wrangler deploy --env preview

# Tail logs
npx wrangler tail
```
