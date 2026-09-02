import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Hydration patterns to treat as failures - React/SSR mismatch warnings.
 */
const isHydrationError = (text: string) =>
  text.includes("Hydration") ||
  text.includes("hydration") ||
  text.includes("did not match") ||
  text.includes("server rendered") ||
  // The production build says it by number: #418 is the text mismatch,
  // #423 the tree that had to be regenerated on the client.
  text.includes("Minified React error #418") ||
  text.includes("Minified React error #423");

test.describe("Hydration", () => {
  test("page hydrates without errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/docs/guides-introduction");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    // The app rendered (SSR + hydration produced a working page).
    // Note: we no longer assert the "Hydrated root element" log - it is an
    // `info` log that the production logger correctly suppresses, and the
    // docs e2e runs against the production build.
    await expect(page.locator("#root")).not.toBeEmpty();

    // No React hydration mismatch errors in the console.
    expect(consoleErrors.filter(isHydrationError)).toHaveLength(0);
  });

  /**
   * The production host serves the prerendered `/404` page for ANY unknown
   * path (`not_found_handling: "404-page"` in alepha.config.ts), so the
   * client hydrates HTML that was rendered at `/404` while the URL says
   * `/docs/<missing>`. Anything in the shell that derives from the URL then
   * differs between the two, and React #418 fires on every 404 (blight
   * #521, quest #1675). The node server behind this suite renders the URL
   * it is given, so the mismatch is reproduced by fulfilling the navigation
   * with the built 404 page, the way the edge does.
   */
  test("a 404 served for a docs URL hydrates without errors", async ({
    page,
  }) => {
    const notFound = readFileSync(
      join(process.cwd(), "dist/public/404.html"),
      "utf8",
    );
    await page.route("**/docs/no-such-document", (route) =>
      route.fulfill({ status: 404, contentType: "text/html", body: notFound }),
    );

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/docs/no-such-document");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    await expect(page.locator("#root")).not.toBeEmpty();
    // No tab for a document that does not exist: the strip is what differed.
    await expect(page.getByRole("tab")).toHaveCount(0);
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
