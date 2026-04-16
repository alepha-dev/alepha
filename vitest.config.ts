import { existsSync, readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const env = loadEnv();

export default defineConfig({
  test: {
    testTimeout: 10000,
    globals: true,
    onConsoleLog(log) {
      if (log.includes("was not wrapped in act(")) {
        return false;
      }
    },
    coverage: {
      reporter: ["cobertura", "html"],
      include: ["packages/*/src/**/*.ts", "packages/*/src/**/*.tsx"],
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
      LOG_LEVEL: "warn",
      // for testing, let's use Paris timezone as default :)
      TZ: "Europe/Paris",
      // database connection string for tests, installed via docker-compose
      DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:15432/postgres",
      // S3-compatible storage (MinIO via docker-compose) for testing @alepha/bucket-s3
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
            "apps/others/e2e-cli/**",
            "apps/tmp/**",
          ],
        },
      },
      {
        // browser tests
        extends: true,
        test: {
          include: ["packages/*/src/**/*.browser.spec.{ts,tsx}"],
          name: { label: "jsdom", color: "cyan" },
          environment: "jsdom",
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
