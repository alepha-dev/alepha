# Vercel Deployment

Vercel is the easiest path to production. Push to Git, get a URL. Alepha generates the exact structure Vercel expects.

> **Important: Serverless Limitations**
>
> Vercel runs your app as serverless functions. This means some Alepha modules that require long-running processes are **not compatible**:
> - `$queue` - Background job queues
> - `$scheduler` - Cron-based scheduled tasks
> - `$topic` - Pub/sub messaging
>
> **Memory providers are not recommended.** Each serverless invocation runs in isolation, so in-memory state (like `MemoryCacheProvider`) won't persist between requests. Use **Vercel KV** (Redis) or external Redis for caching and state.
>
> All other modules work perfectly: `$action`, `$page`, `$entity`, `$repository`, `$cache` (with Redis), `$bucket`, `$issuer`, `$realm`, and more.
>
> For background jobs on Vercel, use [Vercel Cron Jobs](#cron-jobs) instead.

## Quick Start

```bash
npx alepha build --vercel
cd dist && vercel deploy
```

That's it. Your `$action`s become serverless functions. Your `$page`s get SSR. Static assets go to the CDN.

## What Gets Generated

```
dist/
├── api/
│   └── index.js      # Serverless function entry point
├── public/           # CDN assets
├── vercel.json       # Route rewrites
└── .vercel/
    └── project.json  # Project linking
```

## Configuration

Configure Vercel in your `vite.config.ts`:

```typescript
import { viteAlepha } from "alepha/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    viteAlepha({
      vercel: {
        // Required: link to your Vercel project
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

## Environment Variables

### Required for Build & Deploy

These must be set for `alepha build --vercel` to work:

| Variable | Description |
|----------|-------------|
| `VERCEL_PROJECT_ID` | Your Vercel project ID |
| `VERCEL_ORG_ID` | Your Vercel organization/team ID |

You can find these in your Vercel dashboard under Project Settings → General.

### Recommended for Production

| Variable | Description |
|----------|-------------|
| `APP_SECRET` | Long random string for signing cookies and tokens. Recommended for security. |
| `DATABASE_URL` | Your database connection string |

Set variables in your Vercel dashboard or via CLI:

```bash
vercel env add APP_SECRET your-secret-key
vercel env add DATABASE_URL postgres://...
```

### Storage Variables

| Variable | Description |
|----------|-------------|
| `BLOB_READ_WRITE_TOKEN` | For Vercel Blob storage |

## Cold Starts

Vercel serverless functions experience **cold starts** - a delay when your function hasn't been invoked recently and needs to initialize.

**What to expect:**
- Free tier: Cold starts can be noticeable (1-3 seconds)
- Pro tier: Faster cold starts with more resources
- Enterprise: Provisioned concurrency available

**Alepha is Serverless Native.** We design the engine with serverless in mind and continuously optimize startup performance. However, the free tier has resource constraints that affect cold start times.

**Tips to reduce cold starts:**
- Keep your bundle size small
- Minimize dependencies
- Use Vercel Pro for production workloads
- Consider [Docker deployment](./2-docker.md) if cold starts are unacceptable

We're actively working every day to improve loading performance on serverless platforms.

## File Storage with Vercel Blob

Need file uploads? Use Vercel Blob storage:

```typescript
import { $bucket } from "alepha/bucket";
import { AlephaBucketVercel } from "@alepha/bucket-vercel";

class MyApp {
  avatars = $bucket({ name: "avatars", maxSize: 5 }); // 5 MB limit
}

// In your main.ts
alepha.with(AlephaBucketVercel);
```

Set `BLOB_READ_WRITE_TOKEN` in your Vercel environment variables. Done.

## Cron Jobs

Since `$scheduler` doesn't work on serverless, use Vercel's native cron jobs instead:

```typescript
viteAlepha({
  vercel: {
    projectId: process.env.VERCEL_PROJECT_ID,
    orgId: process.env.VERCEL_ORG_ID,
    config: {
      crons: [
        { path: "/api/cron/daily-cleanup", schedule: "0 0 * * *" },
        { path: "/api/cron/hourly-sync", schedule: "0 * * * *" }
      ]
    }
  }
})
```

Then create the corresponding actions:

```typescript
export const dailyCleanup = $action({
  route: { method: "GET", path: "/cron/daily-cleanup" },
  handler: async () => {
    // Your cleanup logic
    return { success: true };
  }
});
```

## Database Options

### Vercel Postgres

```bash
# Add Vercel Postgres integration
vercel integrations add postgres
```

The `DATABASE_URL` is automatically set.

### External Postgres

Use any Postgres provider (Neon, Supabase, Railway):

```env
DATABASE_URL=postgres://user:pass@host:5432/database?sslmode=require
```

## Deployment Commands

```bash
# Preview deployment
npx alepha build --vercel && cd dist && vercel

# Production deployment
npx alepha build --vercel && cd dist && vercel --prod
```
