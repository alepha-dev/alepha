import { expect, test } from "./_fixtures.ts";
import { signInAsAdmin } from "./_helpers.ts";

/**
 * Admin analytics page (`/admin/analytics`).
 *
 * Smoke: the page is reachable by an admin, the `from` clause defaults to the
 * first code-declared dataset, and a query round-trips (an empty result
 * on a fresh database renders the empty state, not an error).
 *
 * The dataset assertion reads the trigger's text. `from` is a Base UI
 * `Select`, so the control is a `role=combobox` BUTTON rather than a native
 * `<select>`: it has no `value` to assert on, and its `<option>`-equivalents
 * live in an unmounted popup where `getByText` would resolve them and then
 * fail the visibility check.
 *
 * The admin account is auto-promoted on first login because `_fixtures.ts`
 * passes `ADMIN_EMAIL` to each worker's server, the same pattern as
 * `admin-user-detail.spec.ts`.
 */
test.describe("admin analytics", () => {
  test("lists datasets and runs an empty query", async ({ page }) => {
    // The account is created once per worker by `_fixtures.ts`; this only signs in.
    await signInAsAdmin(page);

    await page.goto("/admin/analytics");
    await page.waitForLoadState("domcontentloaded");

    // The `from` clause defaults to the first declared dataset: core's
    // `project_activity` since the analytics datasets split per module and
    // core registers first (#E75, #Q2623). It was `sigil_views` while one
    // `LoreAnalytics` class declared every dataset with the views first.
    const from = page.getByRole("combobox", { name: /pick a dataset/i });
    await expect(from).toContainText("project_activity", { timeout: 15_000 });

    // The panel runs itself on every edit, so the empty state is already up;
    // the button re-runs the same query, which must not break it.
    await page.getByRole("button", { name: /run query/i }).click();
    await expect(page.getByText(/no data for this query/i)).toBeVisible({
      timeout: 15_000,
    });
  });
});
