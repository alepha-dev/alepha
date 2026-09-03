import { defineConfig, devices } from "@playwright/test";

/*
 * The e2e port comes from the 4300-4999 band, which is reserved for e2e and
 * disjoint from every dev port in the repo — see `playwright.port.ts`. Never a
 * dev port (33xx) and never 5173/5174: those are Vite's default and its first
 * fallback, so an app running `yarn dev` would be adopted by this suite.
 * `e2ePort` derives the slot from the checkout (so two worktrees never share a
 * server), bind-tests it, and moves on if anything is listening. `E2E_PORT`
 * overrides.
 */

export default defineConfig({
  testDir: "./e2e",
  // PoC: fullyParallel, made safe by one Lore instance per worker.
  //
  // `globalSetup` and `webServer` are gone. Both existed to serve ONE shared
  // server: global setup registered the realm admin against it, and webServer
  // started it. `_fixtures.ts` now boots a server per worker, registers that
  // worker's admin, and hands each spec its own `baseURL`.
  fullyParallel: true,
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
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
