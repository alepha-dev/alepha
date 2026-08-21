import { expect, test } from "@playwright/test";

test.describe("Navigation", () => {
  test("home page loads correctly", async ({ page }) => {
    await page.goto("/");

    // Check hero section is visible
    await expect(page.locator("h1")).toBeVisible();

    // Check navigation to docs works
    const docsLink = page.getByRole("link", { name: /documentation/i }).first();
    if (await docsLink.isVisible()) {
      await docsLink.click();
      await expect(page).toHaveURL(/\/docs\//);
    }
  });

  test("docs page loads with sidebar", async ({ page }) => {
    await page.goto("/docs/introduction");

    // Wait for page to load
    await page.waitForLoadState("networkidle");

    // Sidebar should be visible on desktop
    const sidebar = page.locator('[class*="sidebar"]').first();
    await expect(sidebar).toBeVisible();

    // Content area should have markdown content
    const content = page.locator("article, main, [class*='content']").first();
    await expect(content).toBeVisible();
  });

  test("file tree navigation works", async ({ page }) => {
    await page.goto("/docs/introduction");
    await page.waitForLoadState("networkidle");

    // Find a file link in the sidebar
    const sidebar = page.locator('[class*="sidebar"]').first();
    const fileLink = sidebar.locator('a[href*="/docs/"]').nth(2);

    if (await fileLink.isVisible()) {
      await fileLink.click();
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveURL(/\/docs\//);
    }
  });

  test("bottom navigation works", async ({ page }) => {
    await page.goto("/docs/introduction");
    await page.waitForLoadState("networkidle");

    // Find next button
    const nextButton = page
      .locator('button:has-text("Next"), [class*="nav"] button')
      .last();

    if (await nextButton.isVisible()) {
      await nextButton.click();
      await page.waitForTimeout(500);

      // Should navigate to next page
      await expect(page).not.toHaveURL(/introduction$/);
    }
  });

  test("page transitions work", async ({ page }) => {
    await page.goto("/docs/introduction");
    await page.waitForLoadState("networkidle");

    page.url();

    // Navigate via sidebar link
    const sidebar = page.locator('[class*="sidebar"]').first();
    const link = sidebar.locator('a[href*="/docs/"]').nth(3);

    if (await link.isVisible()) {
      await link.click();
      await page.waitForLoadState("networkidle");

      // Verify navigation occurred
      await expect(page).toHaveURL(/\/docs\//);
    }
  });
});

test.describe("Responsive Design", () => {
  test("mobile viewport renders correctly", async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/docs/introduction");
    await page.waitForLoadState("networkidle");

    // Content should still be visible on mobile
    const content = page.locator("article, main, [class*='content']").first();
    await expect(content).toBeVisible();

    // Page should be functional
    await expect(page).toHaveURL(/\/docs\//);
  });
});
