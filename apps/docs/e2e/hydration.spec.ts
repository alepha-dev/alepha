import { expect, test } from "@playwright/test";

test.describe("Hydration", () => {
  test("page hydrates without errors", async ({ page }) => {
    const consoleLogs: string[] = [];
    const consoleErrors: string[] = [];

    // Capture console messages
    page.on("console", (msg) => {
      const text = msg.text();
      if (msg.type() === "error") {
        consoleErrors.push(text);
      } else {
        consoleLogs.push(text);
      }
    });

    // Navigate to page
    await page.goto("/docs/introduction");
    await page.waitForLoadState("networkidle");

    // Wait a bit for any async hydration
    await page.waitForTimeout(500);

    // Check for hydration success log
    const hasHydrationLog = consoleLogs.some((log) =>
      log.includes("Hydrated root element"),
    );
    expect(hasHydrationLog).toBe(true);

    // Check for NO hydration errors
    const hydrationErrors = consoleErrors.filter(
      (err) =>
        err.includes("Hydration") ||
        err.includes("hydration") ||
        err.includes("did not match") ||
        err.includes("server rendered"),
    );
    expect(hydrationErrors).toHaveLength(0);
  });

  test("home page hydrates without errors", async ({ page }) => {
    const consoleLogs: string[] = [];
    const consoleErrors: string[] = [];

    page.on("console", (msg) => {
      const text = msg.text();
      if (msg.type() === "error") {
        consoleErrors.push(text);
      } else {
        consoleLogs.push(text);
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    // Check for hydration success
    const hasHydrationLog = consoleLogs.some((log) =>
      log.includes("Hydrated root element"),
    );
    expect(hasHydrationLog).toBe(true);

    // No hydration errors
    const hydrationErrors = consoleErrors.filter(
      (err) =>
        err.includes("Hydration") ||
        err.includes("hydration") ||
        err.includes("did not match") ||
        err.includes("server rendered"),
    );
    expect(hydrationErrors).toHaveLength(0);
  });
});
