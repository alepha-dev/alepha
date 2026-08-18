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
const port = e2ePort("shop");

export default defineConfig({
  testDir: "./e2e",
  reporter: process.env.CI ? "list" : "html",
  /*
   * Serial, single worker. The suite shares one database and one catalogue: two
   * workers buying the last Bague Nadir at once would make the oversell test
   * flake and prove nothing. Parallelism here would buy seconds and cost trust.
   */
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  globalTimeout: 900_000,
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  use: {
    baseURL: `http://localhost:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    /*
     * Pin the locale. The interface is bilingual and picks the browser's language
     * — a suite asserting French text on a machine whose Chrome asks for English
     * fails for a reason that has nothing to do with the shop. The first
     * exploratory run of this app failed exactly that way.
     */
    locale: "fr-FR",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    /*
     * Never reuse, not even locally.
     *
     * This was `!process.env.CI` for the faster inner loop, and it silently
     * invalidated two full runs: a server left over from an interrupted run kept
     * listening on the port, Playwright adopted it, and the suite tested a build
     * from before the fix under test. The symptom was a bug that stayed red while
     * the same request answered correctly by hand — which is the most expensive
     * kind of wrong answer a suite can give.
     *
     * A rebuild costs about a minute. Being lied to costs an afternoon.
     */
    reuseExistingServer: false,
    command: "yarn start",
    url: `http://localhost:${port}`,
    timeout: 240_000,
    env: {
      SERVER_PORT: `${port}`,
      /*
       * In memory, like `apps/examples/playground`. A file on disk was the first attempt
       * and it cost two whole runs: `node_modules/.alepha/` is created by the dev
       * server, not by `yarn start`, so the built server either found no
       * directory or inherited a file it could not write ("attempt to write a
       * readonly database"). Every test then failed at registration, which reads
       * as thirty-three application bugs and is in fact one path.
       *
       * In memory there is no directory to create, no file to inherit, and the
       * suite starts from the migrations plus the seed every time.
       */
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? ":memory:",
      APP_SECRET: "e2e-secret-not-a-real-one",
      /*
       * The built bundle, but not in production mode.
       *
       * `MockCheckoutController` refuses to confirm a payment when
       * `isProduction()` — a deliberate guard, since that endpoint is an
       * unauthenticated "mark as paid". Running the suite in production mode
       * would fail every checkout test for the right reason, so the mode is
       * lowered rather than the guard weakened. The code under test is still the
       * real build.
       */
      NODE_ENV: "development",
      /*
       * Stripe off, whatever the developer's shell says.
       *
       * `main.server.ts` switches to Stripe as soon as `STRIPE_SECRET_KEY` is
       * set, and Playwright's `env` is merged over `process.env` rather than
       * replacing it — so a key exported in a terminal would silently redirect
       * the whole funnel to Stripe Checkout and fail every payment spec for a
       * reason that has nothing to do with the shop. The suite tests the mock
       * deliberately; it says so here rather than hoping.
       */
      STRIPE_SECRET_KEY: "",
    },
    /*
     * `yarn start` logs every request at info level, so piping stdout buried the
     * failure blocks under thousands of lines of `GET /chunk.…js 200` and made a
     * run unreadable. Errors still surface: stderr is piped, and a request that
     * fails logs there.
     */
    stdout: "ignore",
    stderr: "pipe",
  },
});
