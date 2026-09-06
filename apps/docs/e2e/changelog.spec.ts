import { expect, test } from "@playwright/test";

/**
 * The changelog carries the ten most recent releases, open, with a scope
 * filter over them. Both halves have been wrong before: the page used to carry
 * the whole history, and the releases used to be collapsed.
 */
test.describe("Changelog", () => {
  test("shows the ten most recent releases, open", async ({ page }) => {
    await page.goto("/changelog");

    const releases = page.locator("article");
    await expect(releases).toHaveCount(10);

    // Open, not collapsed: the changes of the newest release are on the page
    // without anything being clicked first.
    await expect(releases.first().locator("li").first()).toBeVisible();

    // Older releases are reachable rather than dropped.
    await expect(
      page.getByRole("link", { name: "Older releases on GitHub" }),
    ).toBeVisible();
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

    const scopes = page.locator("article li > span:first-child");
    await expect(scopes.first()).toHaveText("bay");
    const after = await page.locator("article li").count();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);

    // All puts it back, and takes the param out of the URL with it.
    await page.getByRole("button", { name: "All" }).click();
    await expect(page).not.toHaveURL(/scope=/);
    await expect(page.locator("article li")).toHaveCount(before);
  });

  test("?scope= accepts raw scope tokens, and says so when nothing matches", async ({
    page,
  }) => {
    // `orm` and `react` name no group, so this exercises the raw form, and
    // the extra button that shows a filter the six cannot express.
    await page.goto("/changelog?scope=orm,react");
    await expect(
      page.getByRole("button", { name: "orm,react" }),
    ).toHaveAttribute("aria-pressed", "true");

    const scopes = await page
      .locator("article li > span:first-child")
      .allTextContents();
    expect(scopes.length).toBeGreaterThan(0);
    for (const scope of scopes) {
      expect(scope).toMatch(/\b(orm|react)\b/);
    }

    await page.goto("/changelog?scope=no-such-scope");
    await expect(page.locator("article")).toHaveCount(0);
    await expect(
      page.getByText(/No change in the last 10 releases/),
    ).toBeVisible();
  });

  /**
   * Scopes are normalised in `gen-tree.ts` to the module they name: a commit
   * scoped `users` is `alepha/api/users`, and reaches the page as `api/users`.
   * Without it `?scope=api` misses half the module's own history.
   */
  test("scopes are shown as the module path they name", async ({ page }) => {
    await page.goto("/changelog?scope=api");

    const scopes = await page
      .locator("article li > span:first-child")
      .allTextContents();
    expect(scopes.length).toBeGreaterThan(0);
    expect(scopes).toContain("api/users");
    // The bare spellings are rewritten, never shown.
    expect(scopes).not.toContain("users");
    expect(scopes).not.toContain("api-users");
  });
});
