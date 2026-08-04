import { defineConfig, devices } from "@playwright/test";

// 3304 sits in the same band as the other apps' e2e ports (docs 3302, lore
// 3303, example-ssr 3311/3312). Never use 5173/5174 — Vite's default and its
// first fallback — or any unrelated dev server running locally squats the port
// and `reuseExistingServer: false` (set under CI) turns that into a hard fail.
const port = Number(process.env.E2E_PORT ?? 3304);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  reporter: process.env.CI ? "list" : "html",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  // Stop once a run is clearly broken rather than retrying every remaining
  // spec twice. Five tolerates one flaky test burning all its retries; a
  // systemic breakage (server down, auth broken) trips it almost immediately
  // and reports in seconds instead of minutes.
  maxFailures: process.env.CI ? 5 : 0,
  timeout: 60_000,
  // Under the workflow's step timeout on purpose, so Playwright is the thing
  // that notices and prints why — a step killed from outside takes the report
  // with it.
  globalTimeout: 360_000,
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  use: {
    baseURL: `http://localhost:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    reuseExistingServer: !process.env.CI,
    command: "yarn start",
    url: `http://localhost:${port}`,
    env: {
      NODE_ENV: "production",
      // The e2e server runs the production build; Alepha now refuses to boot in
      // production with the built-in default APP_SECRET, so inject a test one.
      APP_SECRET: "e2e-test-secret",
      SERVER_PORT: String(port),
      DATABASE_URL: ":memory:",
    },
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
