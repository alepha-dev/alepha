import { expect, test } from "@playwright/test";

/**
 * Hydration patterns to treat as failures — React/SSR mismatch warnings.
 */
const isHydrationError = (text: string) =>
  text.includes("Hydration") ||
  text.includes("hydration") ||
  text.includes("did not match") ||
  text.includes("server rendered");

test.describe("Hydration", () => {
  test("page hydrates without errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/docs/introduction");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    // The app rendered (SSR + hydration produced a working page).
    // Note: we no longer assert the "Hydrated root element" log — it is an
    // `info` log that the production logger correctly suppresses, and the
    // docs e2e runs against the production build.
    await expect(page.locator("#root")).not.toBeEmpty();

    // No React hydration mismatch errors in the console.
    expect(consoleErrors.filter(isHydrationError)).toHaveLength(0);
  });

  test("home page hydrates without errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    await expect(page.locator("#root")).not.toBeEmpty();
    expect(consoleErrors.filter(isHydrationError)).toHaveLength(0);
  });
});
