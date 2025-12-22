# Deployment

You've built your app. Now you need to put it somewhere.

Alepha compiles to a standard Node.js application, but we optimize the output for different deployment targets. Same code, different runtimes. You write once, deploy anywhere.

## The Build Command

```bash
npx alepha build
```

This single command does a lot:
1. Compiles your TypeScript backend.
2. Bundles your React frontend with Vite.
3. Optimizes and minifies assets.
4. Outputs everything to `dist/`.

Add flags to target specific platforms:

```bash
npx alepha build --vercel      # Vercel serverless
npx alepha build --cloudflare  # Cloudflare Workers
npx alepha build --docker      # Docker container
npx alepha build --stats       # Show bundle analysis
```

## Target: Docker / VPS

The classic approach. Run your app on a VPS (DigitalOcean, Hetzner, AWS EC2) or any container platform (Fly.io, Railway, ECS).

```bash
# Build with Docker support
npx alepha build --docker

# Build the image
docker build -t my-app ./dist

# Run it
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e DATABASE_URL=postgres://... \
  -e APP_SECRET=your-secret-key \
  my-app
```

The generated Dockerfile is lean. We prune `node_modules` to production dependencies only, so your image stays small.

### What Gets Generated

```
dist/
├── index.js          # Your compiled server
├── public/           # Static assets (CSS, JS, images)
├── Dockerfile        # Ready-to-build Docker image
└── package.json      # Production dependencies only
```

## Target: Vercel (Serverless)

Vercel is the easiest path to production. Push to Git, get a URL. Alepha generates the exact structure Vercel expects.

### Quick Start

```bash
npx alepha build --vercel
cd dist && vercel deploy
```

That's it. Your `$action`s become serverless functions. Your `$page`s get SSR. Static assets go to the CDN.

### Configuration

You can configure Vercel in your `vite.config.ts`:

```typescript
import { viteAlepha } from "alepha/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    viteAlepha({
      vercel: {
        // Optional: link to existing project
        projectId: process.env.VERCEL_PROJECT_ID,
        orgId: process.env.VERCEL_ORG_ID,

        // Optional: add cron jobs
        config: {
          crons: [
            { path: "/api/cron/cleanup", schedule: "0 0 * * *" }
          ]
        }
      }
    })
  ]
});
```

### What Gets Generated

```
dist/
├── api/
│   └── index.js      # Serverless function entry point
├── public/           # CDN assets
├── vercel.json       # Route rewrites
└── .vercel/
    └── project.json  # Project linking (if configured)
```

### File Storage with Vercel Blob

Need file uploads? Use Vercel Blob storage:

```typescript
import { $bucket, FileStorageProvider } from "alepha/bucket";
import { VercelFileStorageProvider, AlephaBucketVercel } from "@alepha/bucket-vercel";

class MyApp {
  avatars = $bucket({ name: "avatars", maxSize: 5 }); // 5 MB limit
}

// In your main.ts
alepha.with(AlephaBucketVercel);
```

Set `BLOB_READ_WRITE_TOKEN` in your Vercel environment variables. Done.

## Target: Cloudflare Workers

Cloudflare Workers run at the edge, milliseconds from your users. Cold starts are nearly instant. Perfect for global applications.

### Quick Start

```bash
npx alepha build --cloudflare
cd dist && npx wrangler deploy
```

### Project Setup

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

### Custom Deploy Command

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

### What Gets Generated

```
dist/
├── index.js              # Your bundled application
├── main.cloudflare.js    # Worker entry point
├── public/               # Static assets (served by Workers Sites)
└── wrangler.jsonc        # Wrangler configuration
```

### Using Cloudflare D1 (SQLite at the Edge)

D1 is Cloudflare's serverless SQLite database. It runs at the edge, so your database is as fast as your workers.

**1. Create a D1 database:**

```bash
npx wrangler d1 create my-database
# Note the database ID from the output
```

**2. Set the connection string:**

```env
# .env.production
DATABASE_URL=cloudflare-d1://my-database:your-database-id
```

The format is `cloudflare-d1://binding-name:database-id`.

**3. That's it.**

Alepha automatically:
- Detects the D1 connection string
- Configures the `d1_databases` binding in `wrangler.jsonc`
- Uses the D1 driver instead of PostgreSQL
- Runs your Drizzle migrations on deploy

Your entities and repositories work exactly the same:

```typescript
import { $entity, $repository, pg } from "alepha/orm";

const userEntity = $entity({
  name: "users",
  schema: t.object({
    id: pg.primaryKey(),
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

### Wrangler Configuration

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

## File Storage Options

Alepha's `$bucket` primitive abstracts file storage. Switch providers without changing code.

### Local (Development)

```typescript
// Default in development - files stored on disk
const uploads = $bucket({ name: "uploads" });
```

### S3-Compatible (AWS, R2, MinIO)

Works with AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces, and any S3-compatible service.

```typescript
import { S3FileStorageProvider, AlephaBucketS3 } from "@alepha/bucket-s3";

alepha.with(AlephaBucketS3);
```

Environment variables:

```env
# AWS S3
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...
S3_REGION=us-east-1

# Cloudflare R2
S3_ENDPOINT=https://account-id.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_REGION=auto

# MinIO (self-hosted)
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
```

### Vercel Blob

```typescript
import { AlephaBucketVercel } from "@alepha/bucket-vercel";

alepha.with(AlephaBucketVercel);
```

```env
BLOB_READ_WRITE_TOKEN=vercel_blob_...
```

### Azure Blob Storage

```typescript
import { AlephaBucketAzure } from "@alepha/bucket-azure";

alepha.with(AlephaBucketAzure);
```

```env
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
```

## Environment Variables

Alepha loads environment variables from `.env` files in development. In production, use your platform's environment configuration.

### Required Variables

Every production deployment needs:

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | Set to `production` |
| `APP_SECRET` | Long random string for signing cookies and tokens |
| `DATABASE_URL` | Your database connection string |

### Database URLs by Platform

```env
# PostgreSQL (most platforms)
DATABASE_URL=postgres://user:pass@host:5432/database

# Cloudflare D1
DATABASE_URL=cloudflare-d1://binding-name:database-id

# SQLite (local dev)
DATABASE_URL=sqlite://./data.db
```

### Platform-Specific Variables

**Vercel:**
```env
VERCEL_PROJECT_ID=prj_...
VERCEL_ORG_ID=team_...
BLOB_READ_WRITE_TOKEN=vercel_blob_...
```

**Cloudflare:**
```env
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
```

## Summary

| Target | Command | Best For |
|--------|---------|----------|
| Docker | `--docker` | Full control, any hosting |
| Vercel | `--vercel` | Easiest deployment, great DX |
| Cloudflare | `--cloudflare` | Edge performance, global reach |

Pick based on your needs:
- **"I want the easiest path"** → Vercel
- **"I need edge performance"** → Cloudflare Workers
- **"I want full control"** → Docker on any VPS

Your Alepha code stays the same. Only the deployment target changes.
