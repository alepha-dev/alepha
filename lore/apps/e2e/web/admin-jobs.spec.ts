import { expect, test } from "./_fixtures.ts";
import { signInAsAdmin } from "./_helpers.ts";

/**
 * The admin job page (`/admin/jobs/:jobName`), end to end on a real Lore.
 *
 * `quality.prune-runs` is the job driven: a cron with no `retry`, so Trigger
 * now runs it inline inside the request, and idempotent on an empty database.
 * Its retention keeps the success (the cadence default of a daily job), so the
 * run it just made is a row the table shows and the drawer opens.
 *
 * No particular log line is asserted: that job logs only when it removed
 * something, and an empty database gives it nothing to remove.
 */
test.describe("admin job page", () => {
  test("triggers a cron from its page, lists the run, and opens it", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    await page.goto("/admin/jobs/quality.prune-runs");
    await page.waitForLoadState("domcontentloaded");

    // The tab and the aside both name the job.
    await expect(page).toHaveTitle("Admin - Job");
    await expect(page.getByText("quality.prune-runs").first()).toBeVisible();
    await expect(
      page.getByText("Prunes each project's quality runs down to its limit."),
    ).toBeVisible();

    await page.getByRole("button", { name: "Trigger now" }).click();
    await expect(page.getByText("Triggered quality.prune-runs")).toBeVisible({
      timeout: 10_000,
    });

    const succeeded = page.getByRole("cell", { name: "Succeeded" }).first();
    await expect(succeeded).toBeVisible({ timeout: 10_000 });

    await succeeded.click();
    await expect(page).toHaveURL(/[?&]execution=/);
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByText("Execution", { exact: true })).toBeVisible();
    await expect(drawer.getByText("Logs", { exact: true })).toBeVisible();
    // A finished run: its logs are either lines or the one-line "none kept",
    // never the in-progress notice.
    await expect(
      drawer.getByText("The logs arrive when the run ends."),
    ).toHaveCount(0);
  });
});
