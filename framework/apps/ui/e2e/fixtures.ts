import { test as base } from "@playwright/test";
import { CspGuard } from "alepha/testing/playwright";

/**
 * Every spec of this suite imports `test` from here: its page fails the test
 * on the first Content-Security-Policy violation (#Q3343). The app sends the
 * strict policy, so a new inline script anywhere fails the suite that
 * reaches it.
 */
export * from "@playwright/test";
export const test = CspGuard.extend(base);
