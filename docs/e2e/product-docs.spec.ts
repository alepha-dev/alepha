import { expect, test } from "@playwright/test";

/**
 * Bay and Lore docs in their own URL space (quest #1603).
 *
 * They used to publish as flat slugs under the framework's space, so a Bay
 * guide was `/docs/bay-guides-introduction` and read as a framework page that
 * happened to be named `bay-` something. Three doc sets now have three URL
 * spaces, three trees and three sidebars, and the framework's 378 pages did
 * not move.
 */
test.describe("Product doc sets", () => {
  test("a Bay guide lives under /bay/docs and shows only Bay in its sidebar", async ({
    page,
  }) => {
    await page.goto("/bay/docs/guides-introduction");
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });

    const explorer = page.locator('nav[aria-label="Documentation explorer"]');
    await expect(explorer).toBeVisible();

    // The framework's own root folders are the tell: if the tree were still
    // shared, `guides` and `reference` would be sitting here beside Bay's.
    await expect(explorer.getByText("reference", { exact: true })).toHaveCount(
      0,
    );
    await expect(explorer.getByText("cli", { exact: true })).toHaveCount(0);
  });

  test("a Lore guide does the same", async ({ page }) => {
    await page.goto("/lore/docs/guides-introduction");
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });

    const explorer = page.locator('nav[aria-label="Documentation explorer"]');
    await expect(explorer.getByText("reference", { exact: true })).toHaveCount(
      0,
    );
  });

  test("the old flat URLs redirect instead of 404ing", async ({ page }) => {
    // Both were live, so they have to keep resolving. The redirect lives in
    // the framework route's loader, which is the only place that still sees
    // these slugs.
    await page.goto("/docs/bay-guides-introduction");
    await expect(page).toHaveURL(/\/bay\/docs\/guides-introduction$/, {
      timeout: 15_000,
    });

    await page.goto("/docs/lore-guides-introduction");
    await expect(page).toHaveURL(/\/lore\/docs\/guides-introduction$/, {
      timeout: 15_000,
    });
  });

  test("the framework docs did not move", async ({ page }) => {
    await page.goto("/docs/guides-introduction");
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });

    const explorer = page.locator('nav[aria-label="Documentation explorer"]');
    // And its tree still carries its own roots, including the llm folder,
    // which is deliberately not repeated in the other two.
    await expect(explorer.getByText("llm", { exact: true })).toBeVisible();
  });

  test("Framework is the highlighted product on a framework doc page", async ({
    page,
  }) => {
    // It owns `/` AND `/docs/*` and cannot match by prefix, so it used to
    // match `/` exactly and no product was highlighted on any of its pages.
    await page.goto("/docs/guides-introduction");
    const nav = page.locator('nav[aria-label="Products"]');
    await expect(nav.locator(".is-active")).toHaveText("Framework", {
      timeout: 15_000,
    });
  });

  test("Bay is the highlighted product on a Bay doc page", async ({ page }) => {
    await page.goto("/bay/docs/guides-introduction");
    const nav = page.locator('nav[aria-label="Products"]');
    await expect(nav.locator(".is-active")).toHaveText("Bay", {
      timeout: 15_000,
    });
  });

  test("the Bay landing page offers a way into its guides", async ({
    page,
  }) => {
    // #1604: the guides were reachable only from the sidebar of a page you
    // already had to be on.
    await page.goto("/bay");
    const cta = page.getByRole("link", { name: /get started/i }).first();
    await expect(cta).toBeVisible({ timeout: 15_000 });
    await cta.click();
    await expect(page).toHaveURL(/\/bay\/docs\/guides-introduction$/, {
      timeout: 15_000,
    });
  });

  test("the Lore landing page does the same", async ({ page }) => {
    await page.goto("/lore");
    const cta = page.getByRole("link", { name: /get started/i }).first();
    await expect(cta).toBeVisible({ timeout: 15_000 });
    await cta.click();
    await expect(page).toHaveURL(/\/lore\/docs\/guides-introduction$/, {
      timeout: 15_000,
    });
  });
});
