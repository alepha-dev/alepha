import { expect, test } from "./fixtures.ts";

/**
 * A page rendered in the browser only (`ssr: false`), under the enforced CSP
 * (#Q3343): its document carries no React markup, and everything the client
 * then inserts must pass the same policy. The guard of `./fixtures.ts` fails
 * the test on any violation.
 *
 * `REACT_SSR_ENABLED=false`, the switch the quest first named, turns off
 * every page route instead: the server then answers 404 for a page, so there
 * is no client-rendered document to drive. A page with `ssr: false` is that
 * document.
 */
test.describe("Client-rendered page under the CSP", () => {
  test("renders in the browser with the strict policy on", async ({ page }) => {
    const response = await page.goto("/client-rendered");

    expect(response?.headers()["content-security-policy"]).toContain(
      "script-src 'self'",
    );
    await expect(page.locator("#message")).toHaveText(
      "Rendered in the browser",
    );
  });
});
