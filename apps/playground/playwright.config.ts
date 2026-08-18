import { defineConfig, devices } from "@playwright/test";
import { e2ePort } from "../../playwright.port.ts";

/*
 * The e2e port comes from the 4300-4999 band, which is reserved for e2e and
 * disjoint from every dev port in the repo — see `playwright.port.ts`. Never a
 * dev port (33xx) and never 5173/5174: those are Vite's default and its first
 * fallback, so an app running `yarn dev` would be adopted by this suite.
 * `e2ePort` derives the slot from the checkout (so two worktrees never share a
 * server), bind-tests it, and moves on if anything is listening. `E2E_PORT`
 * overrides.
 */
const port = e2ePort("playground");

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
    // Never reuse a running server. The port is bind-tested free moments before
    // this starts, so there is nothing legitimate to adopt: anything answering
    // here raced into the slot during the build and is not this run's build.
    reuseExistingServer: false,
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
