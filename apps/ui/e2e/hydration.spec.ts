import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * React/SSR mismatch reports. The production build says it by number: #418 is
 * the text mismatch, #423 the tree that had to be regenerated on the client.
 */
const isHydrationError = (text: string) =>
  text.includes("Hydration") ||
  text.includes("hydration") ||
  text.includes("did not match") ||
  text.includes("Minified React error #418") ||
  text.includes("Minified React error #423");

test.describe("Hydration", () => {
  /**
   * ui.alepha.dev is a static host: `/` is the file the prerender wrote, not
   * a render of the request. The prerender boots the app to `configure` and
   * never `start`, so a store value set on `start` is missing from that file
   * while the browser has it. The theme list was one: the file had no theme
   * picker, the browser rendered one, and every first load threw #418 (blight
   * #586, quest #2341).
   *
   * ⚠️ The prerendered file is served explicitly. `yarn start` is a node
   * server that has run `start` and renders the URL itself, so a plain
   * navigation agrees with the browser and proves nothing.
   */
  test("the prerendered home hydrates without errors", async ({ page }) => {
    const prerendered = readFileSync(
      join(process.cwd(), "dist/public/index.html"),
      "utf8",
    );
    await page.route(
      (url) => url.pathname === "/",
      (route) => route.fulfill({ contentType: "text/html", body: prerendered }),
    );

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    await expect(
      page.getByRole("button", { name: "Pick theme" }).first(),
    ).toBeVisible();
    expect(consoleErrors.filter(isHydrationError)).toEqual([]);
  });
});
