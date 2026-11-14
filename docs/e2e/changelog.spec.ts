import { expect, test } from "@playwright/test";

/**
 * The changelog carries the most recent published Lore releases (#Q3638),
 * open, with a scope filter over them.
 *
 * ⚠️ Written against no particular release. CI builds the page from the real
 * history and a build without `LORE_API_KEY` from the sample, so a test that
 * named a quest or counted ten releases would pass on one and fail on the
 * other. Each test reads what the page shows and checks how the page treats
 * it.
 */
test.describe("Changelog", () => {
  test("shows the most recent releases, open, ten at most", async ({
    page,
  }) => {
    await page.goto("/changelog");

    const releases = page.locator("article");
    const count = await releases.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(10);

    // Open, not collapsed: the changes of the newest release are on the page
    // without anything being clicked first.
    await expect(releases.first().locator("li").first()).toBeVisible();

    // Older releases are reachable rather than dropped.
    await expect(
      page.getByRole("link", { name: "Older releases on GitHub" }),
    ).toHaveAttribute("href", "https://github.com/alepha-dev/alepha/releases");
  });

  test("a scope button filters the timeline and writes the URL", async ({
    page,
  }) => {
    await page.goto("/changelog");
    const before = await page.locator("article li").count();

    await page.getByRole("button", { name: "Bay" }).click();
    await expect(page).toHaveURL(/\?scope=bay$/);
    await expect(page.getByRole("button", { name: "Bay" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Every change left is Bay's, and something was filtered out.
    const scopes = await page
      .locator("article li > span:first-child")
      .allTextContents();
    for (const scope of scopes) {
      expect(scope.split("/")[0]).toBe("bay");
    }
    expect(scopes.length).toBeLessThan(before);

    // All puts it back, and takes the param out of the URL with it.
    await page.getByRole("button", { name: "All" }).click();
    await expect(page).not.toHaveURL(/scope=/);
    await expect(page.locator("article li")).toHaveCount(before);
  });

  test("?scope= accepts a raw scope token, and says so when nothing matches", async ({
    page,
  }) => {
    // Take a real scope off the page rather than naming one, and one no button
    // names: `cli`, `ui`, `lore` and `bay` are groups, read more widely.
    await page.goto("/changelog");
    const groups = new Set(["framework", "cli", "ui", "lore", "bay"]);
    const token = (
      await page.locator("article li > span:first-child").allTextContents()
    )
      .map((scope) => scope.trim().split("/")[0])
      .find((namespace) => !groups.has(namespace));
    expect(token).toBeTruthy();

    await page.goto(`/changelog?scope=${token}`);
    // The filter applies after hydration: wait for the button it shows.
    await expect(page.getByRole("button", { name: token! })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const shown = await page
      .locator("article li > span:first-child")
      .allTextContents();
    expect(shown.length).toBeGreaterThan(0);
    for (const each of shown) {
      expect(each.split("/")).toContain(token!);
    }

    await page.goto("/changelog?scope=no-such-scope");
    await expect(page.locator("article")).toHaveCount(0);
    await expect(
      page.getByText(/No change in the last 10 releases/),
    ).toBeVisible();
  });

  /**
   * A Lore area is shown as the module path it names: `alepha/orm` is `orm`,
   * `@alepha/ui` is `ui`. With the package prefix left on, every framework
   * change would fall outside the `cli` and `ui` filters.
   */
  test("scopes are shown without the package prefix", async ({ page }) => {
    await page.goto("/changelog");
    const scopes = await page
      .locator("article li > span:first-child")
      .allTextContents();
    expect(scopes.length).toBeGreaterThan(0);
    for (const scope of scopes) {
      expect(scope).not.toMatch(/^@?alepha\//);
    }
  });
});
