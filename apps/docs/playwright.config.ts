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
const port = e2ePort("docs");

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  globalTimeout: 600_000,
  reporter: "html",
  use: {
    screenshot: "only-on-failure",
    baseURL: `http://localhost:${port}`,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Never reuse a running server. The port is bind-tested free moments before
    // this starts, so there is nothing legitimate to adopt: anything answering
    // here raced into the slot during the build and is not this run's build.
    reuseExistingServer: false,
    command: "yarn start",
    url: `http://localhost:${port}`,
    timeout: 120_000,
    env: {
      SERVER_PORT: `${port}`,
      // `yarn start` runs the production build (`node dist`), which now refuses
      // to boot on the default APP_SECRET - inject a test one.
      APP_SECRET: "e2e-test-secret",
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
