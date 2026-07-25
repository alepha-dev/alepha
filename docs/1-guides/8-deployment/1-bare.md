# Bare Deployment

The default deployment target. `alepha build` produces a self-contained `dist/` folder that runs on any machine with Node.js or Bun installed.

## Build

```bash
alepha build
```

This bundles both server and client code into a single optimized output. The server bundle includes all dependencies -- no `npm install` is needed in production.

## Run

```bash
node dist        # Node.js
bun dist         # Bun
```

The server starts on `http://localhost:3000` by default. Configure the host and port with environment variables:

```bash
SERVER_HOST=0.0.0.0 SERVER_PORT=8080 node dist
```

## Output Structure

```
dist/
  index.js       # Server entry point
  public/        # Client assets (if React frontend exists)
  drizzle/       # Database migrations (if using $entity)
```

If no React frontend is present, only `index.js` is generated.

## Runtime Flag

Optimize the build for a specific runtime:

```bash
alepha build --runtime=bun
```

The `--runtime=bun` flag uses Bun-specific export conditions during bundling.

## Configuration

Set the target in `alepha.config.ts` to avoid passing flags:

```typescript check
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  build: {
    target: "bare",
    runtime: "node",
  },
});
```

`bare` is the default target. You do not need to set it explicitly unless you want to override a different default.

## Deployment

Copy the `dist/` folder to any server and run it. No build tools, no package managers, no configuration files required on the target machine.

Works on:
- VPS (DigitalOcean, Hetzner, Linode)
- Bare metal servers
- Any container runtime
- systemd, PM2, or any process manager

## Multi-replica `$job` cron jobs

When you run more than one replica (e.g. 10 Docker instances behind a load balancer), `$job({ cron, ... })` acquires a per-job distributed lock by default so the handler runs **once per tick across the fleet**, not once per replica. The default `MemoryLockProvider` is per-process — to get cross-replica coordination, register a real lock provider:

```ts
import { AlephaLockRedis } from "alepha/lock/redis";

const app = Alepha.create()
  .with(AlephaLockRedis)   // Redis-backed lock store
  .with(AlephaApiJobs);
```

Set `lock: false` on a `$job` if you genuinely want every replica to fire the handler.

## Retry granularity

`$job` retries are sweep-driven on every platform: no exponential backoff. A failing handler is rescheduled with `scheduledAt = now` and the next sweep tick (default `*/15 * * * *`, configurable via `jobConfig.sweepCron`) picks it up. Lower `sweepCron` if you need tighter retry latency.
