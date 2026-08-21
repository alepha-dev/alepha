import { defineConfig, devices } from "@playwright/test";

import { e2ePort } from "../../../playwright.port.ts";

/*
 * The e2e port comes from the 4300-4999 band, which is reserved for e2e and
 * disjoint from every dev port in the repo — see `playwright.port.ts`. Never a
 * dev port (33xx) and never 5173/5174: those are Vite's default and its first
 * fallback, so an app running `yarn dev` would be adopted by this suite.
 * `e2ePort` derives the slot from the checkout (so two worktrees never share a
 * server), bind-tests it, and moves on if anything is listening. `E2E_PORT`
 * overrides.
 */
const port = e2ePort("ssr");

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  globalTimeout: 600_000,
  reporter: "html",
  fullyParallel: false,
  use: {
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    {
      name: "prod",
      use: { baseURL: `http://localhost:${port}` },
    },
  ],
  webServer: [
    {
      // Never reuse a running server. The port is bind-tested free moments before
      // this starts, so there is nothing legitimate to adopt: anything answering
      // here raced into the slot during the build and is not this run's build.
      reuseExistingServer: false,
      command: "yarn start:e2e",
      url: `http://localhost:${port}`,
      timeout: 180_000,
      env: { SERVER_PORT: `${port}` },
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
