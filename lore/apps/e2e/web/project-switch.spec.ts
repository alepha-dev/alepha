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
        // Visible only: a Plate's folder tabs are a nav of links too.
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

  /**
   * The same switch, on the network and frame by frame (#Q3823). No API call
   * is held here: the batch a request rides in is the subject.
   */
  test("from /quests, the quests page neither comes back nor reads the next project", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const t = Date.now();
    await registerAndVerify(page, `trips${t}@example.com`, "SwitchTest123!");
    const alpha = `Gamma${t}`.slice(0, 20);
    const beta = `Delta${t}`.slice(0, 20);
    const a = await createProjectViaWizard(page, alpha);
    const b = await createProjectViaWizard(page, beta);

    await page.goto(`/${a.slug}/quests`);
    await expect(page.getByTestId("quests-table")).toBeVisible();
    await page.waitForLoadState("networkidle");

    // Every frame from the click on: is the quests page on screen again? It
    // unmounts at the click, and the frame the navigation ends on used to
    // show it once more, over the next project's quests.
    await page.evaluate(() => {
      const w = window as unknown as { __back: string[]; __clicked: boolean };
      w.__back = [];
      w.__clicked = false;
      document.addEventListener("click", () => (w.__clicked = true), {
        capture: true,
        once: true,
      });
      let gone = false;
      const tick = () => {
        const table = document.querySelector<HTMLElement>(
          '[data-testid="quests-table"]',
        );
        const visible = !!table?.checkVisibility();
        if (w.__clicked && !visible) gone = true;
        if (gone && visible) w.__back.push(location.pathname);
        requestAnimationFrame(tick);
      };
      tick();
    });

    const requests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/")) {
        requests.push(url.pathname + url.search);
      }
    });

    await page
      .getByTestId("project-rail-item")
      .and(page.getByLabel(beta))
      .click();
    await page.waitForURL((url) => url.pathname === `/${b.slug}`);
    await expect(page.getByTestId("project-page-skeleton")).toHaveCount(0);
    await page.waitForLoadState("networkidle");

    const actionsOf = (request: string) =>
      new URLSearchParams(request.split("?")[1] ?? "").get("actions") ?? "";

    // The page being left read nothing in the project being opened.
    expect(
      requests.filter((it) => actionsOf(it).split(",").includes("getQuests")),
    ).toEqual([]);

    const back = await page.evaluate(
      () => (window as unknown as { __back: string[] }).__back,
    );
    expect(back).toEqual([]);
  });
});
