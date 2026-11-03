import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import { createProjectViaWizard, registerAndVerify } from "./_helpers.ts";

declare global {
  interface Window {
    __viewTransitions: string[][];
  }
}

/**
 * `$page({ viewTransition })` on the three pages that use it, in a real
 * browser: jsdom has no view transition, so only here does a class reach an
 * animation. The pages commit in a React transition since #Q3029, so scroll and
 * a superseded navigation are pinned here too.
 */

/**
 * Records, for each view transition the page starts, the keyframes it plays.
 */
const recordViewTransitions = async (page: Page) => {
  await page.addInitScript(() => {
    window.__viewTransitions = [];
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = ((options: ViewTransitionUpdateCallback) => {
      const transition = start(options);
      const animations: string[] = [];
      window.__viewTransitions.push(animations);
      void transition.ready.then(() => {
        for (const animation of document.getAnimations()) {
          const name = (animation as CSSAnimation).animationName;
          if (name) {
            animations.push(name);
          }
        }
      });
      return transition;
    }) as typeof document.startViewTransition;
  });
};

const played = (page: Page) =>
  page.evaluate(() => window.__viewTransitions.flat());

const started = (page: Page) =>
  page.evaluate(() => window.__viewTransitions.length);

test.describe("View transitions", () => {
  test("leaving Home for the wizard plays its exit and the wizard's enter", async ({
    page,
  }) => {
    await registerAndVerify(
      page,
      `vt-home-${Date.now()}@example.com`,
      "GoodPassw0rd",
    );
    await recordViewTransitions(page);

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: /start your first project/i }).click();
    await page.waitForURL((url) => url.pathname === "/new-project");

    await expect.poll(() => played(page)).toContain("fadeScaleOut");
    expect(await played(page)).toContain("fadeIn");
  });

  test("a project's first open plays its enter", async ({ page }) => {
    await registerAndVerify(
      page,
      `vt-open-${Date.now()}@example.com`,
      "GoodPassw0rd",
    );
    await recordViewTransitions(page);

    await createProjectViaWizard(page, `Vt${Date.now()}`.slice(0, 24));

    await expect.poll(() => played(page)).toContain("projectOpen");
  });

  test("prefers-reduced-motion starts no view transition", async ({ page }) => {
    await registerAndVerify(
      page,
      `vt-reduced-${Date.now()}@example.com`,
      "GoodPassw0rd",
    );
    await recordViewTransitions(page);
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: /start your first project/i }).click();
    await page.waitForURL((url) => url.pathname === "/new-project");
    await expect(page.locator('input[type="text"]').first()).toBeVisible();

    expect(await started(page)).toBe(0);
  });

  test("pages that ask for nothing start no view transition", async ({
    page,
  }) => {
    await registerAndVerify(
      page,
      `vt-plain-${Date.now()}@example.com`,
      "GoodPassw0rd",
    );
    const { slug } = await createProjectViaWizard(
      page,
      `Vp${Date.now()}`.slice(0, 24),
    );
    await recordViewTransitions(page);

    await page.goto(`/${slug}/activity`);
    await page.waitForLoadState("networkidle");
    await page.locator(`a[href="/${slug}/quests"]`).first().click();
    await page.waitForURL((url) => url.pathname === `/${slug}/quests`);
    await page.waitForLoadState("networkidle");

    expect(await started(page)).toBe(0);
  });
});

test.describe("Navigation under startTransition", () => {
  const openProject = async (page: Page, name: string) => {
    await registerAndVerify(
      page,
      `${name}-${Date.now()}@example.com`,
      "GoodPassw0rd",
    );
    const { slug } = await createProjectViaWizard(
      page,
      `${name}${Date.now()}`.slice(0, 24),
    );
    await page.goto(`/${slug}/activity`);
    await page.waitForLoadState("networkidle");
    return slug;
  };

  test("a new page lands at the top and Back restores the offset", async ({
    page,
  }) => {
    const slug = await openProject(page, "vtscroll");

    // A body child, outside what React renders: both pages are short here,
    // and it survives the navigation.
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "5000px";
      document.body.appendChild(spacer);
      window.scrollTo(0, 900);
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(900);

    await page.evaluate((href) => {
      document.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)?.click();
    }, `/${slug}/quests`);
    await page.waitForURL((url) => url.pathname === `/${slug}/quests`);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

    await page.goBack();
    await page.waitForURL((url) => url.pathname === `/${slug}/activity`);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(900);
  });

  test("the last of two quick clicks is the page that stays", async ({
    page,
  }) => {
    const slug = await openProject(page, "vtrace");

    await page.evaluate(
      ([first, second]) => {
        document
          .querySelector<HTMLAnchorElement>(`a[href="${first}"]`)
          ?.click();
        document
          .querySelector<HTMLAnchorElement>(`a[href="${second}"]`)
          ?.click();
      },
      [`/${slug}/epics`, `/${slug}/quests`],
    );

    await page.waitForURL((url) => url.pathname === `/${slug}/quests`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("quests-table")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/${slug}/quests`);
  });
});
