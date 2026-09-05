import { defineConfig, devices } from "@playwright/test";

import { e2ePort } from "../../playwright.port.ts";

/*
 * The e2e port comes from the 4300-4999 band, which is reserved for e2e and
 * disjoint from every dev port in the repo - see `playwright.port.ts`. Never a
 * dev port (33xx) and never 5173/5174: those are Vite's default and its first
 * fallback, so an app running `yarn dev` would be adopted by this suite.
 * `e2ePort` derives the slot from the checkout (so two worktrees never share a
 * server), bind-tests it, and moves on if anything is listening. `E2E_PORT`
 * overrides.
 */
const port = e2ePort("ui");

export default defineConfig({
  testDir: "./e2e",
  reporter: process.env.CI ? "list" : "html",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  maxFailures: process.env.CI ? 5 : 0,
  timeout: 60_000,
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
      // Alepha refuses to boot in production with the built-in default.
      APP_SECRET: "e2e-test-secret",
      SERVER_PORT: String(port),
      // No DATABASE_URL: this app has no ORM. If one ever appears here, it
      // needs `:memory:` the way shop injects it.
    },
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
