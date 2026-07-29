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

Deploy through the [platform plugin](/docs/cli-plugins-platform), which drives the whole pipeline and installs the Vercel CLI automatically if missing:

```bash
alepha p up --env production
```

Or deploy a build manually with the Vercel CLI's prebuilt mode:

```bash
alepha build --target=vercel
cd dist && vercel deploy --prebuilt --prod
```

## Generated Output

The build produces a [Vercel Build Output API v3](https://vercel.com/docs/build-output-api/v3) tree:

- `dist/.vercel/output/config.json` -- Version 3 config with routes (filesystem first, everything else to the function)
- `dist/.vercel/output/functions/index.func/` -- The serverless function: handler, bundled server, `package.json`, `.vc-config.json`
- `dist/.vercel/output/static/` -- Static client assets (moved from `dist/public/`)
- `dist/.vercel/project.json` -- Project linking (if `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` are set)

The generated `config.json` routes all non-file requests to the function:

```json
{
  "version": 3,
  "routes": [
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/index" }
  ]
}
```

## Configuration

```typescript check
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

- **Queue-backed job dispatch** (`AlephaApiJobsQueue`) is not supported -- `$job` still works in direct mode, which is the default
- **Cron** (`$job({ cron })`) is auto-collected at build time: each cron job becomes a Vercel cron entry hitting `/_alepha/cron/<name>` (guarded by `CRON_SECRET`); entries you define in the `vercel` config `crons` option win on path conflicts
- **Cold starts** -- serverless functions have startup latency on the first request
- **Execution time limits** -- Vercel imposes per-request timeouts depending on your plan

## Recommendation

If serverless is a goal, prefer Cloudflare Workers with `--target=cloudflare`. Cloudflare Workers have:

- Lower cold start latency
- Native cron trigger support via `$job({ cron })`
- D1 database integration
- Lower cost at scale

Use Vercel when you have existing infrastructure on the platform or need specific Vercel features (preview deployments, analytics, etc.).
