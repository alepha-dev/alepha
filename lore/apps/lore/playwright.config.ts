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
const port = e2ePort("lore");

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  globalTimeout: 600_000,
  // Email verification is delivered by a fire-and-forget background job
  // (DirectJobDispatcher defers the send), so `registerAndVerify` races the
  // deferred file write. Under CI load that write occasionally slips past the
  // poll window — retry the failed test rather than red the whole run. Local
  // runs keep 0 retries for fast, honest feedback.
  retries: process.env.CI ? 2 : 0,
  outputDir: ".playwright/results",
  reporter: [["html", { outputFolder: ".playwright/report", open: "never" }]],
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
    timeout: 120_000,
    command: "yarn start",
    url: `http://localhost:${port}`,
    // Never reuse a running server. The port is bind-tested free moments before
    // this starts, so there is nothing legitimate to adopt: anything answering
    // here raced into the slot during the build and is not this run's build.
    reuseExistingServer: false,
    env: {
      SERVER_PORT: `${port}`,
      // `yarn start` runs the production build (`node dist`), which now refuses
      // to boot on the default APP_SECRET — inject a test one.
      APP_SECRET: "e2e-test-secret",
      // Cloudflare Turnstile "always-pass" test keys — `yarn start` runs `node dist`
      // which doesn't load `.env`, so e2e needs these injected explicitly.
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      // Lift the per-IP registration cap — the full suite registers dozens
      // of users from a single localhost IP. Default 10 trips mid-run.
      REGISTRATION_IP_MAX_ATTEMPTS: "1000",
      // Fixed admin email so the admin-user-detail spec can register an
      // account and have it auto-promoted to `admin` on first login.
      ADMIN_EMAIL: "admin@example.com",
    },
  },
});
