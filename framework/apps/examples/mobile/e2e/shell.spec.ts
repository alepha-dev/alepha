import { expect, test } from "@playwright/test";

import { API_URL } from "../playwright.config.ts";

/**
 * The app shell a native binary carries, run in a browser.
 *
 * What every phone boots through: `index.html` with nothing rendered on the
 * server, a loader calling the API on another origin, and, when that API
 * cannot be reached or does not answer, the offline screen within the boot
 * deadline and a retry that recovers. A browser is not native: token
 * transport, secure storage, deep links and the native chrome are proven on
 * devices, not here.
 */
test.describe("the mobile app shell", () => {
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("ships index.html with no server-rendered page in it", async ({
    request,
  }) => {
    const html = await (await request.get("/")).text();

    expect(html).toContain('<div id="root"></div>');
    expect(html).not.toContain('id="__ssr"');
  });

  test("renders the first page from a loader on the API's origin", async ({
    page,
  }) => {
    const hello = page.waitForResponse(`${API_URL}/api/hello`);

    await page.goto("/");

    expect((await hello).status()).toBe(200);
    await expect(page.getByTestId("server-time")).toContainText("API time:");
  });

  test("commits the offline screen when the API is unreachable, and retry recovers", async ({
    page,
  }) => {
    await page.route(`${API_URL}/**`, (route) => route.abort());

    await page.goto("/");

    const screen = page.locator('[data-alepha-offline="network"]');
    await expect(screen).toBeVisible({ timeout: 5_000 });

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await screen.getByRole("button", { name: "Retry" }).click();

    await expect(page.getByTestId("server-time")).toContainText("API time:");
  });

  test("commits the offline screen within the deadline when the API never answers", async ({
    page,
  }) => {
    // Accepted and never answered: what a captive portal looks like.
    await page.route(`${API_URL}/**`, () => {});

    await page.goto("/");

    const screen = page.locator('[data-alepha-offline="deadline"]');
    // The deadline is 5000 ms from the start of the boot.
    await expect(screen).toBeVisible({ timeout: 7_000 });

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await screen.getByRole("button", { name: "Retry" }).click();

    await expect(page.getByTestId("server-time")).toContainText("API time:");
  });
});
