# Vercel Deployment

The `vercel` build target generates a Vercel-compatible output with serverless function entry point and routing configuration.

## Build

```bash
alepha build --target=vercel
```

This forces the `node` runtime. You cannot combine `--target=vercel` with `--runtime=bun` or `--runtime=workerd`.

## Environment Variables

Required for deployment:

| Variable | Description |
|----------|-------------|
| `VERCEL_TOKEN` | Vercel API token |
| `VERCEL_ORG_ID` | Vercel organization/team ID |
| `VERCEL_PROJECT_ID` | Vercel project ID |

## Deploy

`alepha deploy` detects the `vercel.json` in `dist/` and runs the Vercel CLI:

```bash
alepha build --target=vercel
alepha deploy
```

For production deployment:

```bash
alepha deploy --mode production
```

If the Vercel CLI is not installed, the deploy command installs it automatically as a dev dependency.

## Generated Output

The build produces:

- `dist/vercel.json` -- Route rewrites and build configuration
- `dist/api/index.js` -- Serverless function entry point
- `dist/public/` -- Static client assets (if React frontend exists)
- `dist/.vercel/project.json` -- Project linking (if `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are set)

The `vercel.json` rewrites all routes to the serverless function:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/api/index.js" }],
  "buildCommand": "",
  "installCommand": "",
  "outputDirectory": "public"
}
```

## Configuration

```typescript
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  build: {
    target: "vercel",
    vercel: {
      projectName: "my-app",
      orgId: "team_abc123",
      projectId: "prj_abc123",
      config: {
        crons: [
          { path: "/api/cron", schedule: "0 * * * *" },
        ],
      },
    },
  },
});
```

The `orgId` and `projectId` can also be set via environment variables (`VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`), which take precedence over config values.

## Limitations

Vercel serverless functions have constraints that affect some Alepha features:

- **Queue** (`$queue`) is not supported
- **Cron** (`$scheduler`) has limited support -- must be configured manually via the `vercel` config `crons` option
- **Cold starts** -- serverless functions have startup latency on the first request
- **Execution time limits** -- Vercel imposes per-request timeouts depending on your plan

## Recommendation

If serverless is a goal, prefer Cloudflare Workers with `--target=cloudflare`. Cloudflare Workers have:

- Lower cold start latency
- Native cron trigger support via `$scheduler`
- D1 database integration
- Lower cost at scale

Use Vercel when you have existing infrastructure on the platform or need specific Vercel features (preview deployments, analytics, etc.).
