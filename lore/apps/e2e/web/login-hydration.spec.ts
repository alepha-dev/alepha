import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import { registerAndVerify } from "./_helpers.ts";

/**
 * Collects every hydration mismatch React reports on a page, from the console
 * and from uncaught errors alike: production React throws #418 as an error,
 * development React logs the full message.
 */
const watchMismatches = (page: Page) => {
  const mismatches: string[] = [];
  const isMismatch = (text: string) =>
    /react error #41[589]|#42[35]|hydrat|did ?n[o']t match/i.test(text);
  page.on("console", (msg) => {
    if (msg.type() === "error" && isMismatch(msg.text())) {
      mismatches.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    if (isMismatch(err.message)) mismatches.push(err.message);
  });
  return mismatches;
};

/**
 * The sign-in page is server-rendered (public pages keep real HTML), so it
 * hydrates, and a render that differs between server and browser throws React
 * #418 there. Blight #795 (#Q2642) reported one on `/auth/login` in
 * production; none of the cases below reproduces it, which points at
 * something outside the app rewriting the form before hydration (a password
 * manager extension is the usual suspect on a login page). These hold the
 * page's own render to the server's, so a real regression is told apart from
 * that noise.
 *
 * As in `theme-flicker.spec.ts`, the assertion is a negative, so each case
 * waits for `data-alepha-hydrated` before reading the list.
 */
test.describe("sign-in page hydration", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const path of [
      "/auth/login",
      "/auth/login?redirect=%2Flore",
      "/auth/login?error=Nope",
    ]) {
      test(`${path} hydrates without a mismatch, system=${scheme}`, async ({
        context,
        page,
      }) => {
        await context.clearCookies();
        await page.emulateMedia({ colorScheme: scheme });
        const mismatches = watchMismatches(page);

        await page.goto(path, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("html[data-alepha-hydrated='true']");

        expect(mismatches).toEqual([]);
      });
    }
  }

  test.describe("in French", () => {
    test.use({ locale: "fr-FR" });

    test("/auth/login hydrates without a mismatch", async ({ page }) => {
      const mismatches = watchMismatches(page);

      await page.goto("/auth/login", { waitUntil: "domcontentloaded" });
      await page.waitForSelector("html[data-alepha-hydrated='true']");

      expect(mismatches).toEqual([]);
    });
  });

  test("a signed-in visitor's /auth/login hydrates without a mismatch", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const t = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await registerAndVerify(page, `loginhyd${t}@example.com`, "LoginHyd123!");
    const mismatches = watchMismatches(page);

    for (const path of ["/auth/login", "/auth/login?redirect=%2F"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("html[data-alepha-hydrated='true']");
    }

    expect(mismatches).toEqual([]);
  });
});
