import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "./_helpers.ts";

/**
 * Admin analytics page (`/admin/analytics`).
 *
 * Smoke: the page is reachable by an admin, the `from` clause defaults to the
 * first code-declared sigil dataset, and a query round-trips (an empty result
 * on a fresh database renders the empty state, not an error).
 *
 * The dataset assertion reads the trigger's text. `from` is a Base UI
 * `Select`, so the control is a `role=combobox` BUTTON rather than a native
 * `<select>`: it has no `value` to assert on, and its `<option>`-equivalents
 * live in an unmounted popup where `getByText` would resolve them and then
 * fail the visibility check.
 *
 * The admin account is auto-promoted on first login because
 * `playwright.config.ts` sets `ADMIN_EMAIL=admin@example.com` for the
 * webServer, the same pattern as `admin-user-detail.spec.ts`.
 */
test.describe("admin analytics", () => {
  test("lists datasets and runs an empty query", async ({ page }) => {
    // The account is created once by `global-setup.ts`; this only signs in.
    await signInAsAdmin(page);

    await page.goto("/admin/analytics");
    await page.waitForLoadState("domcontentloaded");

    // The `from` clause defaults to the first declared dataset.
    const from = page.getByRole("combobox", { name: /pick a dataset/i });
    await expect(from).toContainText("sigil_views", { timeout: 15_000 });

    // The panel runs itself on every edit, so the empty state is already up;
    // the button re-runs the same query, which must not break it.
    await page.getByRole("button", { name: /run query/i }).click();
    await expect(page.getByText(/no data for this query/i)).toBeVisible({
      timeout: 15_000,
    });
  });
});
