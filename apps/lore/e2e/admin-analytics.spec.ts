import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "./_helpers.ts";

/**
 * Admin analytics page (`/admin/analytics`).
 *
 * Smoke: the page is reachable by an admin, lists the two code-declared
 * sigil datasets, and a query round-trips (an empty result on a fresh
 * database renders the empty state, not an error).
 *
 * The admin account is auto-promoted on first login because
 * `playwright.config.ts` sets `ADMIN_EMAIL=admin@example.com` for the
 * webServer — same pattern as `admin-user-detail.spec.ts`.
 */
test.describe("admin analytics", () => {
  test("lists datasets and runs an empty query", async ({ page }) => {
    // The account is created once by `global-setup.ts`; this only signs in.
    await signInAsAdmin(page);

    await page.goto("/admin/analytics");
    await page.waitForLoadState("domcontentloaded");

    // The dataset picker defaults to the first declared dataset.
    await expect(page.getByText("sigil_views").first()).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: /run query/i }).click();
    await expect(page.getByText(/no data for this query/i)).toBeVisible({
      timeout: 15_000,
    });
  });
});
