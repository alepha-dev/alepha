import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = dirname(fileURLToPath(import.meta.url));
loadEnv();

export default defineConfig({
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
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY_ID: "mock",
      S3_SECRET_ACCESS_KEY: "mock",
      MQTT_BROKER_URL: "mqtt://localhost:11883",
      REDIS_URL: "redis://localhost:16379",
    },
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
          // jsdom's Storage is dropped by vitest's global population when the
          // host Node exposes a `localStorage` global (Node >= 25). Restore a
          // working `window.localStorage` / `window.sessionStorage`.
          setupFiles: ["./vitest.setup.webstorage.ts"],
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
