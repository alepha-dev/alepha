import { defineConfig } from "@playwright/test";

import base from "./playwright.config.ts";

/*
 * The accessibility scan of the showcase (`e2e/a11y.spec.ts`), on its own
 * config: every route in four token sets is a few hundred axe runs, which does
 * not fit the main suite's six-minute `globalTimeout`. Same server, same
 * browser, same port allocation as `playwright.config.ts`; only the files and
 * the clock differ. CI runs it in its own job of Verify Framework.
 */
export default defineConfig({
  ...base,
  testMatch: "a11y.spec.ts",
  testIgnore: [],
  timeout: 180_000,
  globalTimeout: 1_200_000,
  maxFailures: 0,
  // A retry would re-scan a page that already reported a finding and hide
  // nothing: the scan is deterministic, and a red page is red on purpose.
  retries: 0,
  use: {
    ...base.use,
    // Pinned so a laptop and CI render the same page: a date the fixtures
    // format into a `title` lands in axe's selector, and it moved with the
    // machine's timezone.
    timezoneId: "UTC",
    locale: "en-US",
  },
});
