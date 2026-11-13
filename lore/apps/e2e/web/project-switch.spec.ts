import { expect, test } from "./_fixtures.ts";
import { createProjectViaWizard, registerAndVerify } from "./_helpers.ts";

/**
 * Switching project from a sub-page (#Q3548). The project layout's loader
 * writes the next project's atoms before the page under it has loaded, so
 * the page being left used to re-render over the next project's data: from
 * `/a/quests`, project B's rail icon and sidebar with "Quests" highlighted,
 * then B's dashboard a beat later. The shell now shows a skeleton until the
 * next page is ready.
 *
 * Every API call is held for a moment once the switch starts, which is what
 * makes the window wide enough to watch.
 */
test.describe("Project switch", () => {
  test("from /quests, another project's rail icon is marked at once and shows a skeleton, never the old page", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const t = Date.now();
    await registerAndVerify(page, `switch${t}@example.com`, "SwitchTest123!");
    const alpha = `Alpha${t}`.slice(0, 20);
    const beta = `Beta${t}`.slice(0, 20);
    const a = await createProjectViaWizard(page, alpha);
    const b = await createProjectViaWizard(page, beta);

    await page.goto(`/${a.slug}/quests`);
    await page.waitForLoadState("networkidle");

    // Every frame from the click on: is the old page on screen while the rail
    // already names the next project?
    await page.evaluate((next) => {
      const w = window as unknown as { __stale: string[] };
      w.__stale = [];
      const tick = () => {
        const active = document.querySelector(
          '[data-testid="project-rail-item"][aria-current="page"]',
        );
        // Visible only: the page being left stays mounted, hidden, under
        // the skeleton, and its Plate's folder tabs are a nav of links too.
        const quests = [
          ...document.querySelectorAll<HTMLElement>(
            'nav a[aria-current="page"][href$="/quests"]',
          ),
        ].some((link) => link.checkVisibility());
        if (active?.getAttribute("aria-label") === next && quests) {
          w.__stale.push(location.pathname);
        }
        requestAnimationFrame(tick);
      };
      tick();
    }, beta);

    await page.route("**/api/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });

    await page
      .getByTestId("project-rail-item")
      .and(page.getByLabel(beta))
      .click();
    await expect(page.getByTestId("project-page-skeleton")).toBeVisible();
    // The icon clicked is the current one before its project has loaded.
    await expect(
      page.getByTestId("project-rail-item").and(page.getByLabel(beta)),
    ).toHaveAttribute("aria-current", "page");
    expect(new URL(page.url()).pathname).toBe(`/${a.slug}/quests`);
    await page.waitForURL((url) => url.pathname === `/${b.slug}`);
    await expect(page.getByTestId("project-page-skeleton")).toHaveCount(0);

    const stale = await page.evaluate(
      () => (window as unknown as { __stale: string[] }).__stale,
    );
    expect(stale).toEqual([]);
  });
});
