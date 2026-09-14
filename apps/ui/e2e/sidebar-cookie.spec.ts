import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * A returning visitor who collapsed the sidebar, on a prerendered page
 * (#Q2347).
 *
 * ui.alepha.dev is a static host: `/` is the file the prerender wrote with no
 * cookie, so its shell is expanded. The browser reads the `alepha-ui` cookie
 * before it hydrates and believes the sidebar collapsed. Rendering that belief
 * in the hydration pass drew the other trigger icon over the HTML's, and
 * React #418 threw away the server tree on every load. React's client
 * re-render then made the page LOOK right, which is why the end state alone
 * proves nothing and the console is asserted too.
 *
 * ⚠️ The prerendered file is served explicitly, as in `hydration.spec.ts`:
 * `yarn start` renders the request itself, reads the cookie, and agrees with
 * the browser, so a plain navigation proves nothing.
 */
test.describe("Sidebar cookie on a prerendered page", () => {
  test.beforeEach(async ({ page, context, baseURL }) => {
    const prerendered = readFileSync(
      join(process.cwd(), "dist/public/index.html"),
      "utf8",
    );
    await page.route(
      (url) => url.pathname === "/",
      (route) => route.fulfill({ contentType: "text/html", body: prerendered }),
    );
    await context.addCookies([
      {
        name: "alepha-ui",
        value: encodeURIComponent(
          JSON.stringify({
            mode: "light",
            theme: "default",
            sidebar: { collapsed: true },
          }),
        ),
        url: baseURL,
      },
    ]);
  });

  const read = (page: import("@playwright/test").Page) =>
    page.evaluate(() => ({
      label: document
        .querySelector(
          '[aria-label="Collapse sidebar"], [aria-label="Expand sidebar"]',
        )
        ?.getAttribute("aria-label"),
      state: document
        .querySelector('[data-slot="sidebar"][data-state]')
        ?.getAttribute("data-state"),
    }));

  test("hydrates a collapsed shell with a matching trigger", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    expect(await read(page)).toEqual({
      label: "Expand sidebar",
      state: "collapsed",
    });
    // Not a client re-render that happened to land on the right state: the
    // trigger's two icons differ in structure, so a mismatch is React #418.
    expect(consoleErrors.filter((it) => it.includes("#418"))).toEqual([]);
  });

  /**
   * The same trap without a prerender: the node server caches a `static`
   * page's render, so the HTML a visitor gets is whichever request rendered
   * it first. Primed here without the cookie on purpose, the way another
   * visitor (or another spec in this suite) would have left it.
   */
  test("a page served from the node server's render cache hydrates collapsed", async ({
    page,
    context,
  }) => {
    const cookies = await context.cookies();
    await context.clearCookies();
    const primed = await page.goto("/blocks/control/date");
    expect(await primed?.text()).toContain('aria-label="Collapse sidebar"');
    await context.addCookies(cookies);

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // Not `/`, which this file serves from the prerendered file.
    await page.goto("/blocks/control/date");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    expect(await read(page)).toEqual({
      label: "Expand sidebar",
      state: "collapsed",
    });
    expect(consoleErrors.filter((it) => it.includes("#418"))).toEqual([]);
  });

  test("the first click on the trigger expands it", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    await page
      .getByRole("button", { name: /(Expand|Collapse) sidebar/ })
      .first()
      .click();
    await page.waitForTimeout(300);

    expect(await read(page)).toEqual({
      label: "Collapse sidebar",
      state: "expanded",
    });
  });
});
