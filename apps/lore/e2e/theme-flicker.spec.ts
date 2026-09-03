import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import { registerAndVerify } from "./_helpers.ts";

/**
 * POST to a name-derived action route.
 *
 * A direct path rather than `_helpers`' `apiPost`, which resolves an action
 * through the SSR-injected `apiLinks` map: that map is scoped to what the
 * CURRENT page declares, and this test does its setup from `/`, where
 * `createProject` is not in it. Same reasoning as `roadmap.spec.ts`.
 */
const apiPost = async <T>(
  page: Page,
  path: string,
  body: unknown,
): Promise<T> =>
  (await page.evaluate(
    async ({ path, body }) => {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return r.json();
    },
    { path, body },
  )) as T;

const cookieValue = (mode: string, theme: string) =>
  encodeURIComponent(
    JSON.stringify({ mode, theme, sidebar: { collapsed: false } }),
  );

test.describe("theme no-flash", () => {
  test("dark mode + theme-arcane applied before paint via boot script", async ({
    context,
    page,
    baseURL,
  }) => {
    await context.addCookies([
      {
        name: "alepha-ui",
        value: cookieValue("dark", "arcane"),
        url: String(baseURL),
      },
    ]);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const klass = await page.evaluate(() => document.documentElement.className);
    expect(klass).toContain("dark");
    expect(klass).toContain("theme-arcane");
  });

  test("no dark class without cookie + system=light", async ({
    context,
    page,
  }) => {
    await context.clearCookies();
    await page.emulateMedia({ colorScheme: "light" });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const klass = await page.evaluate(() => document.documentElement.className);
    expect(klass).not.toContain("dark");
    expect(klass).not.toContain("theme-");
  });

  test("system=dark resolves to dark via prefers-color-scheme", async ({
    context,
    page,
  }) => {
    await context.clearCookies();
    await page.emulateMedia({ colorScheme: "dark" });

    await page.goto("/", { waitUntil: "domcontentloaded" });

    const klass = await page.evaluate(() => document.documentElement.className);
    expect(klass).toContain("dark");
  });

  // Regression for blight #10596 (React #418 on the SSR'd home page). With
  // `mode = "system"` (no cookie) and a dark OS, `useResolvedColorMode` used to
  // resolve "light" on the server (no matchMedia) but "dark" on the client's
  // first render, so the color-mode toggle icon hydrated Sun↔Moon and React
  // threw a hydration mismatch. The home page is the only SSR'd route, so it is
  // the only place this can surface.
  test("system=dark home SSR hydrates without a React #418 mismatch", async ({
    context,
    page,
  }) => {
    await context.clearCookies();
    await page.emulateMedia({ colorScheme: "dark" });

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

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // The assertion is a NEGATIVE — "no mismatch was logged" — so there is
    // nothing for Playwright's auto-retry to converge on: the check has to run
    // AFTER hydration or it passes for the wrong reason. This used to be a
    // fixed 500 ms sleep, which is slow when hydration is fast and a false
    // green when CI is loaded. `data-alepha-hydrated` is set by
    // `ReactBrowserRendererProvider` the moment React takes over the server
    // HTML, which is the condition the sleep was approximating.
    await page.waitForSelector("html[data-alepha-hydrated='true']");

    expect(mismatches).toEqual([]);
  });
});

/**
 * The theme's font stylesheet used to be injected by `<ButtonTheme/>`, which
 * only mounts where a theme picker renders. Nearly every Lore page carries
 * `PageHeader` and therefore a picker, which is why this hid for so long -
 * the roadmap is the one page that renders no header at all. It got
 * `theme-arcane`'s colors while `--font-display` resolved to Cinzel with
 * Cinzel never loaded, falling silently down to Times New Roman. Measured
 * before the fix: `document.fonts` held Inter and JetBrains Mono and nothing
 * else. `<ColorScheme/>` owns the link now, and Lore mounts that at the root
 * of `Layout`, above every page including this one.
 */
test.describe("theme fonts", () => {
  test("font loads on the roadmap, the one page with no theme picker", async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const t = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    await registerAndVerify(page, `themefont${t}@example.com`, "ThemeFont123!");

    // Over the API rather than the wizard: this test is about what the
    // document loads, not about how a project gets made.
    const project = await apiPost<{ id: number; slug: string }>(
      page,
      "/api/createProject",
      { title: `TF${t}`.slice(0, 24) },
    );

    await apiPost(page, `/api/updateProjectById/${project.id}`, {
      roadmapVisibility: "public",
    });

    await context.addCookies([
      {
        name: "alepha-ui",
        value: cookieValue("light", "arcane"),
        url: String(baseURL),
      },
    ]);

    await page.goto(`/${project.slug}/roadmap`);

    // The premise: no picker here. If this ever starts failing, the page grew
    // a header and this test has stopped covering the regression it was
    // written for - move it to whatever page has no picker then.
    await expect(page.locator('[aria-label="Pick theme"]')).toHaveCount(0);

    // Injected from an effect, so let the assertion converge rather than
    // reading the DOM once and racing hydration.
    await expect(page.locator("link#alepha-theme-fonts")).toHaveAttribute(
      "href",
      "/fonts/arcane.css",
    );

    // The link is the mechanism; the loaded face is the outcome. Asserting
    // only the link would still pass if the stylesheet 404'd or named a font
    // the theme does not use, which is the failure this whole file is about.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            [
              ...(
                document as unknown as { fonts: Iterable<{ family: string }> }
              ).fonts,
            ].some((f) => f.family === "Cinzel"),
          ),
        { message: "the arcane theme's display face never loaded" },
      )
      .toBe(true);
  });
});
