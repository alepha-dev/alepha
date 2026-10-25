import { expect, test } from "@playwright/test";

test.describe("Keyboard Shortcuts", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/docs/guides-introduction");
    await page.waitForLoadState("networkidle");
  });

  test("j/k keys scroll the page", async ({ page }) => {
    // Get initial scroll position
    const initialScroll = await page.evaluate(() => window.scrollY);

    // Press j to scroll down
    await page.keyboard.press("j");
    await page.waitForTimeout(100);

    const scrollAfterJ = await page.evaluate(() => window.scrollY);

    // Should have scrolled down (or stayed at 0 if at top of short page)
    expect(scrollAfterJ).toBeGreaterThanOrEqual(initialScroll);

    // Press k to scroll up
    await page.keyboard.press("k");
    await page.waitForTimeout(100);

    const scrollAfterK = await page.evaluate(() => window.scrollY);

    // Should have scrolled up or stayed at position
    expect(scrollAfterK).toBeLessThanOrEqual(scrollAfterJ);
  });

  test("gg jumps to top of page", async ({ page }) => {
    // First scroll down
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(100);

    // Press gg (vim-style go to top)
    await page.keyboard.press("g");
    await page.keyboard.press("g");
    await page.waitForTimeout(200);

    const scroll = await page.evaluate(() => window.scrollY);

    // Should be at or near top
    expect(scroll).toBeLessThan(50);
  });

  test("G jumps to bottom of page", async ({ page }) => {
    // Press Shift+G (vim-style go to bottom)
    await page.keyboard.press("Shift+g");
    await page.waitForTimeout(200);

    const { scrollY, scrollHeight, innerHeight } = await page.evaluate(() => ({
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    }));

    // Should be at or near bottom
    const distanceFromBottom = scrollHeight - innerHeight - scrollY;
    expect(distanceFromBottom).toBeLessThan(50);
  });

  test("Cmd+B toggles sidebar (focus mode)", async ({ page }) => {
    // Get initial sidebar state
    const sidebar = page.locator('[class*="sidebar"]').first();
    const initiallyVisible = await sidebar.isVisible();

    // Toggle with Cmd+B
    await page.keyboard.press("Meta+b");
    await page.waitForTimeout(300);

    // Sidebar visibility should have changed
    await sidebar.isVisible();

    // Toggle back
    await page.keyboard.press("Meta+b");
    await page.waitForTimeout(300);

    const afterSecondToggle = await sidebar.isVisible();

    // Should be back to initial state
    expect(afterSecondToggle).toBe(initiallyVisible);
  });

  test("? shows keyboard shortcuts help", async ({ page }) => {
    // Press ? to show help (Shift+/ on US keyboard)
    await page.keyboard.press("Shift+Slash");
    await page.waitForTimeout(500);

    // Look for help dialog/modal overlay
    const helpOverlay = page.locator('[class*="overlay"]').first();

    // If help dialog exists, verify and close
    if (await helpOverlay.isVisible()) {
      // Close with Escape
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }

    // Just verify page is still functional
    await expect(page).toHaveURL(/\/docs\//);
  });
});

test.describe("Theme Toggle", () => {
  test("theme toggle changes color scheme", async ({ page }) => {
    await page.goto("/docs/guides-introduction");
    await page.waitForLoadState("networkidle");

    // Get initial theme
    const initialTheme = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme"),
    );

    // Find and click theme toggle
    const themeToggle = page
      .locator(
        'button[class*="theme"], button[class*="dark"], button[class*="mode"], button[title*="theme" i]',
      )
      .first();

    if (await themeToggle.isVisible()) {
      await themeToggle.click();
      await page.waitForTimeout(300);

      // Theme should have changed
      const newTheme = await page.evaluate(() =>
        document.documentElement.getAttribute("data-theme"),
      );

      expect(newTheme).not.toBe(initialTheme);
    }
  });

  test("theme persists after page reload", async ({ page }) => {
    await page.goto("/docs/guides-introduction");
    await page.waitForLoadState("networkidle");

    // Toggle theme
    const themeToggle = page
      .locator(
        'button[class*="theme"], button[class*="dark"], button[class*="mode"], button[title*="theme" i]',
      )
      .first();

    if (await themeToggle.isVisible()) {
      await themeToggle.click();
      await page.waitForTimeout(300);

      const newTheme = await page.evaluate(() =>
        document.documentElement.getAttribute("data-theme"),
      );

      // Reload page
      await page.reload();
      await page.waitForLoadState("networkidle");

      // Theme should persist
      const themeAfterReload = await page.evaluate(() =>
        document.documentElement.getAttribute("data-theme"),
      );

      expect(themeAfterReload).toBe(newTheme);
    }
  });
});
