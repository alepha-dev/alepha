import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = dirname(fileURLToPath(import.meta.url));
loadEnv();

export default defineConfig({
  resolve: {
    // `apps/lore` maps `@/*` to its own `src/*` in tsconfig, and the "node"
    // project below has no `include` filter (see the WebStorm comment), so it
    // collects lore's specs under THIS config — `apps/lore/vitest.config.ts` is
    // never consulted by a root `yarn test`. Any lore spec that reaches app
    // source transitively therefore has to resolve `@/` here or it dies at
    // import time, which is what `test/app-routes.spec.ts` did the moment it
    // imported `AppRouter.ts` (the first spec anywhere to do so).
    //
    // Safe as a repo-wide alias: `apps/lore` is the only workspace in the tree
    // that uses `@/` imports, so there is nothing to collide with. Lore keeps
    // the same alias in its own config — that is what makes `yarn w lore test`
    // work standalone, where this file is not loaded at all.
    alias: [{ find: /^@\//, replacement: `${repoRoot}/apps/lore/src/` }],
  },
  test: {
    root: repoRoot,
    testTimeout: 10000,
    globals: true,
    onConsoleLog(log) {
      if (log.includes("was not wrapped in act(")) {
        return false;
      }
    },
    coverage: {
      reporter: ["cobertura", "html"],
      include: ["packages/**/src/**/*.ts", "packages/**/src/**/*.tsx"],
      exclude: [
        "apps/**",
        "scripts/**",
        // ignore experimental packages
        "packages/ui",
        "packages/devtools",
        "packages/create-alepha",
        "packages/alepha/src/vite",
        "packages/alepha/src/cli",
        "packages/alepha/src/bin",
        "packages/alepha/src/thread",
      ],
    },
    env: {
      // Do NOT set LOG_LEVEL here. When it is unset in test mode, Alepha's
      // logger buffers logs in memory and prints them to the console only when
      // a test fails (see packages/alepha/src/logger/index.ts). Setting any
      // LOG_LEVEL opts out of that and makes warn/error spam every passing test.
      // for testing, let's use Paris timezone as default :)
      TZ: "Europe/Paris",
      // database connection string for tests, installed via docker-compose
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:15432/postgres",
      // S3-compatible storage (MinIO via docker-compose) for testing NodeS3BucketProvider
      S3_ENDPOINT: "http://127.0.0.1:19090",
      // Must match `initialBuckets` on the s3mock service in compose.yml.
      S3_BUCKET_NAME: "alepha-test",
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY_ID: "mock",
      S3_SECRET_ACCESS_KEY: "mock",
      MQTT_BROKER_URL: "mqtt://localhost:11883",
      REDIS_URL: "redis://localhost:16379",
    },
    // `forks`, the default, and it has to stay that way while `TZ` below is
    // set here.
    //
    // `pool: "threads"` is tempting — half this suite's cumulative work is
    // module loading rather than assertions (~277s importing against ~286s
    // executing over 513 files), and threads amortise that: measured 53s -> 43s
    // standalone, 63s -> 39s in the pipeline, with every test still passing.
    //
    // It was shipped and reverted the same evening. `env.TZ` is applied before
    // a *process* starts, so forks pick it up; worker threads inherit the
    // parent's already-initialised timezone and setting `process.env.TZ` inside
    // one does not re-run tzset. `Localize.spec.tsx` then reads UTC instead of
    // Paris and six date assertions fail — but ONLY where the machine is not
    // already in Europe/Paris. It passed locally and failed on CI, which is the
    // worst possible shape for a regression.
    //
    // To try again: move `TZ` out of `env` and onto the process that spawns
    // vitest (the `test` script), then verify with `TZ=UTC yarn test` locally
    // before believing it.
    //
    // ⚠️ `isolate: false` is a separate dead end — twice as fast again, and 17
    // tests fail on genuine cross-file state pollution (`QueryManager`,
    // `FileAccessProvider`, `ErrorBoundary`). Not flakiness. Do not re-try it
    // without fixing those tests first.
    projects: [
      {
        // node.js tests
        extends: true,
        test: {
          name: { label: "node", color: "green" },
          environment: "node",
          // include: ["packages/**/*.spec.{ts,tsx}"], <-- doesn't work well with Webstorm
          exclude: [
            "**/*.browser.spec.{ts,tsx}",
            "**/*.bun.spec.{ts,tsx}",
            "**/node_modules/**",
            "**/e2e/**",
            // Git worktrees live here. Without this every spec in the repo is
            // collected twice, and the root-anchored excludes below (which a
            // nested checkout does not match) stop applying to the copy — so
            // e2e suites meant for `yarn e2e` run inside `yarn test`.
            "**/.claude/**",
            "apps/e2e-cli/**",
            "apps/tmp/**",
          ],
        },
      },
      {
        // browser tests
        extends: true,
        test: {
          include: ["packages/**/src/**/*.browser.spec.{ts,tsx}"],
          name: { label: "jsdom", color: "cyan" },
          environment: "jsdom",
          // Node >= 25 ships a native Web Storage global. Vitest's jsdom
          // environment refuses to overwrite globals that already exist, so
          // the native (unbacked) `localStorage` shadows jsdom's real
          // `Storage` and `window.localStorage.setItem` ends up undefined.
          // Turning the Node built-in off in the test workers lets jsdom
          // install its own spec-compliant implementation.
          execArgv: ["--no-experimental-webstorage"],
        },
        resolve: {
          conditions: ["browser", "module", "import", "default"],
          mainFields: ["browser", "module", "main"],
        },
      },
    ],
  },
});

function loadEnv(): Record<string, string> {
  // if .env, read and load to var "env"
  if (existsSync(".env")) {
    return readFileSync(".env", "utf-8")
      .split("\n")
      .map((e) => e.trim().split("="))
      .filter((e) => e.length === 2)
      .reduce(
        (acc, cur) => {
          acc[cur[0].trim()] = cur[1].trim();
          return acc;
        },
        {} as Record<string, string>,
      );
  }

  return {};
}
