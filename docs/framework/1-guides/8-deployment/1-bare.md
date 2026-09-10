# Bare Deployment

The default deployment target. `alepha build` produces a self-contained `dist/` folder that runs on any machine with Node.js or Bun installed.

## Build

```bash
alepha build
```

This bundles both server and client code into a single optimized output. The server bundle includes all dependencies - no `npm install` is needed in production.

## Run

```bash
node dist        # Node.js
bun dist         # Bun
```

The server starts on `http://localhost:3000` by default. Configure the host and port with environment variables:

```bash
SERVER_HOST=0.0.0.0 SERVER_PORT=8080 node dist
```

`PORT` is read as a fallback when `SERVER_PORT` is not set, so a host that allocates the port
itself (Heroku, Cloud Run, Railway, Fly) needs no configuration at all. Setting `SERVER_PORT`
always wins over `PORT`.

## Output Structure

```txt
dist/
  index.js       # Server entry point
  public/        # Client assets (if React frontend exists)
```

Database migrations stay in your project's `migrations/` directory - run them with `alepha db migrations apply` against the target database (the docker target copies them into the image for you).

If no React frontend is present, only `index.js` is generated.

## Runtime Flag

Optimize the build for a specific runtime:

```bash
alepha build --runtime=bun
```

The `--runtime=bun` flag uses Bun-specific export conditions during bundling.

## Single Binary

`--compile` turns the build into one executable, with the client's `public/` files inside it:

```bash
alepha build --runtime=bun --compile          # dist/app
alepha build --runtime=bun --compile myapp    # dist/myapp
```

The compiler is `bun build --compile`, so the build needs `--runtime=bun` and Bun on the build machine. The binary carries its own runtime: nothing has to be installed where it runs. `dist/` then holds the binary, `manifest.json` and, when the app has a database, `migrations/`.

```bash
cd dist && APP_SECRET=... SERVER_HOST=127.0.0.1 ./myapp
```

- Run it from the directory that holds `migrations/`: the app reads them relative to where it starts. An app without a database can run from anywhere.
- A compiled app runs in production mode, which refuses to boot without `APP_SECRET` as soon as the app signs anything: sessions, tokens, signed cookies. An app that signs nothing boots without one.
- Set `SERVER_HOST`: under Bun, `localhost` listens on IPv6 `::1` only.
- The binary serves its assets from inside itself, ETag and precompressed brotli included, and ignores any `public/` directory next to it.
- It targets the machine that builds it (`bun-darwin-arm64` on an Apple Silicon Mac). Cross-compile with `build.compile.target`, for example `bun-linux-x64` for a Linux server built on a Mac.
- Expect about 60 MB, almost all of it the Bun runtime. Windows is untested.

The same in `alepha.config.ts`, where `compile` also takes `true` or just a name:

```typescript check
import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  build: {
    runtime: "bun",
    compile: { name: "myapp", target: "bun-linux-x64", minify: true },
  },
});
```

An explicit `--compile` beats the config, and `--no-compile` turns it off. The `docker` target compiles the same way and packages the binary in a distroless image: see the [Docker guide](/docs/guides-deployment-docker).

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

When you run more than one replica (e.g. 10 Docker instances behind a load balancer), `$job({ cron, ... })` acquires a per-job distributed lock by default so the handler runs **once per tick across the fleet**, not once per replica. The default `MemoryLockProvider` is per-process - to get cross-replica coordination, register a real lock provider:

```ts
import { AlephaLockRedis } from "alepha/lock/redis";

const app = Alepha.create()
  .with(AlephaLockRedis) // Redis-backed lock store
  .with(AlephaApiJobs);
```

Set `lock: false` on a `$job` if you genuinely want every replica to fire the handler.

## Retry granularity

`$job` retries are sweep-driven on every platform: no exponential backoff. A failing handler is rescheduled with `scheduledAt = now` and the next sweep tick (default `*/15 * * * *`, configurable via `jobConfig.sweepCron`) picks it up. Lower `sweepCron` if you need tighter retry latency.
