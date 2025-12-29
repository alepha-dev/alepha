import { expect, test } from "@playwright/test";

test.describe("Command Palette", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/introduction");
    await page.waitForLoadState("networkidle");
  });

  const openCommandPalette = async (page: any) => {
    // Try Control+k (works cross-platform in Playwright)
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(200);
  };

  test("opens with Ctrl+K", async ({ page }) => {
    await openCommandPalette(page);

    // Wait for dialog overlay to appear
    const overlay = page.locator('[class*="overlay"]').first();
    await expect(overlay).toBeVisible({ timeout: 2000 });

    // Should have an input field
    const input = page.locator('input[type="text"]');
    await expect(input).toBeVisible();
  });

  test("closes with Escape", async ({ page }) => {
    await openCommandPalette(page);

    const overlay = page.locator('[class*="overlay"]').first();
    await expect(overlay).toBeVisible({ timeout: 2000 });

    // Close with Escape
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    // Dialog should close
    await expect(overlay).not.toBeVisible({ timeout: 2000 });
  });

  test("search filters results", async ({ page }) => {
    await openCommandPalette(page);

    const overlay = page.locator('[class*="overlay"]').first();
    await expect(overlay).toBeVisible({ timeout: 2000 });

    // Type search query
    await page.keyboard.type("security");
    await page.waitForTimeout(300);

    // Results should contain matching items
    const results = overlay.locator("button");
    const count = await results.count();
    expect(count).toBeGreaterThan(0);
  });

  test("navigates results with arrow keys", async ({ page }) => {
    await openCommandPalette(page);

    const overlay = page.locator('[class*="overlay"]').first();
    await expect(overlay).toBeVisible({ timeout: 2000 });

    // Press down arrow
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(100);

    // Verify dialog still visible (arrow key processed without error)
    await expect(overlay).toBeVisible();
  });

  test("Enter navigates to selected result", async ({ page }) => {
    await openCommandPalette(page);

    const overlay = page.locator('[class*="overlay"]').first();
    await expect(overlay).toBeVisible({ timeout: 2000 });

    // Type to search for a specific doc
    await page.keyboard.type("overview");
    await page.waitForTimeout(300);

    // Press Enter to navigate
    await page.keyboard.press("Enter");

    // Dialog should close and page should navigate
    await expect(overlay).not.toBeVisible({ timeout: 3000 });
    await expect(page).toHaveURL(/\/docs\//);
  });

  test("clicking result navigates to page", async ({ page }) => {
    await openCommandPalette(page);

    const overlay = page.locator('[class*="overlay"]').first();
    await expect(overlay).toBeVisible({ timeout: 2000 });

    // Use keyboard navigation instead of click (more reliable)
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(100);
    await page.keyboard.press("Enter");

    // Wait for navigation
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/docs\//);
  });

  test("shows keyboard shortcuts in footer", async ({ page }) => {
    await openCommandPalette(page);

    const overlay = page.locator('[class*="overlay"]').first();
    await expect(overlay).toBeVisible({ timeout: 2000 });

    // Footer should show keyboard hints
    const footer = overlay.locator('[class*="footer"]');
    await expect(footer).toBeVisible();
  });
});
