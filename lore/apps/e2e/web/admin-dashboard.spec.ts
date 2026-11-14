import { expect, test } from "./_fixtures.ts";
import { apiPost, signInAsAdmin } from "./_helpers.ts";

/**
 * Lore's Projects tile on the admin dashboard (#Q3539), on a real Lore.
 *
 * The tile counts the instance's projects with archived ones excluded, and
 * opens the admin Projects list with the same filter, so the list's total is
 * the tile's number, whatever filter the admin left on that list last time.
 */
test.describe("admin dashboard", () => {
  test("the Projects tile leads, and its click lands on a list with the same total", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/admin");
    await apiPost(page, "createProject", { title: "Dashboard tile probe" });
    // A stored filter the tile's link must replace.
    await page.evaluate(() => {
      window.localStorage.setItem(
        "lore.admin.projects.filters",
        JSON.stringify({ activity: "dormant" }),
      );
    });

    await page.goto("/admin");
    const titles = page.locator('[data-slot="card-title"]');
    await expect(titles.first()).toHaveText("Projects");

    const tile = page.getByRole("link").filter({
      has: page
        .locator('[data-slot="card-title"]')
        .getByText("Projects", { exact: true }),
    });
    const value = tile.locator('[data-slot="stat-value"]');
    await expect(value).toHaveText(/^[\d,]+$/);
    const total = Number((await value.innerText()).replace(/\D/g, ""));
    expect(total).toBeGreaterThan(0);

    await tile.click();
    await expect(page).toHaveURL(/\/admin\/projects\?archived=exclude$/);
    await expect(
      page.getByText(new RegExp(`·\\s*\\d+ of ${total}$`)),
    ).toBeVisible();
  });
});
