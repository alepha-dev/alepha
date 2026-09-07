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
  /**
   * ⚠️ Sized from a measurement, and 600_000 was no longer one.
   *
   * On 2026-09-07 CI ran 162 tests on 2 workers, reported `147 passed (10.0m)`
   * and `13 did not run`: the suite had grown past the ceiling, so the job
   * went red with nothing broken in it. A global timeout that the healthy
   * suite reaches is not a hang detector, it is a flake.
   *
   * 15 minutes is ~35% over the clean run, and the `e2e` job's own
   * `timeout-minutes: 30` is the real ceiling - the whole job (build plus
   * every app's suite) took 14 minutes that day, of which lore was 10. Raise
   * this and check that budget, not just this line.
   */
  globalTimeout: 900_000,
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
