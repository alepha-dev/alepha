import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import { createProjectViaWizard, registerAndVerify } from "./_helpers.ts";

/**
 * The shell topbar has to keep every one of its controls reachable at phone
 * width, and the sidebar has to be openable and closable there.
 *
 * The bar is one non-wrapping flex line. On a Lore project page it carries the
 * sidebar trigger, a separator, the breadcrumbs, the Create split button, the
 * search button and four header icons: measured at 375px, 472px of content in
 * 373px of width. Nothing was marked as the one that must survive, so the
 * 100px of overflow fell off the RIGHT end and took Pick theme, Toggle colour
 * mode and the Account menu with it — off-screen, with no horizontal scroll to
 * reach them and no menu they collapse into. The same happened at 768, where
 * the sidebar is docked and eats 255px of the width.
 *
 * ⚠️ The sidebar trigger was never the casualty: it is first in the row and
 * kept its full 32px at every width, before and after. These assert the whole
 * row rather than that one control, because "which end fell off" is an
 * accident of source order and the next control added to the bar can bring the
 * overflow back.
 */
test.describe("Mobile topbar and sidebar", () => {
  const sheet = (page: Page) =>
    page.locator('[data-slot="sidebar"][data-mobile="true"]');

  /**
   * Every header control, with its box, and whether the viewport actually
   * contains it. A control squeezed to zero or pushed past the right edge is
   * still "visible" to Playwright, so this measures instead of asking.
   */
  const headerControls = (page: Page, width: number) =>
    page.evaluate((vw) => {
      const header = document.querySelector("header")!;
      return {
        overflow: header.scrollWidth - header.clientWidth,
        controls: Array.from(header.querySelectorAll("button")).map((b) => {
          const r = b.getBoundingClientRect();
          return {
            label: b.getAttribute("aria-label"),
            offscreen: Math.round(r.x + r.width) > vw || r.x < 0,
            collapsed: r.width < 20 || r.height < 20,
          };
        }),
      };
    }, width);

  const openProject = async (page: Page, tag: string) => {
    const ts = Date.now();
    await registerAndVerify(page, `${tag}${ts}@example.com`, "GoodPassw0rd");
    const { slug } = await createProjectViaWizard(
      page,
      `${tag}${ts}`.slice(0, 20),
      { options: { work: ["board", "releases"] } },
    );
    return slug;
  };

  test("no header control falls off the viewport at mobile widths", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const slug = await openProject(page, "top");

    // 767 and 768 straddle the `useIsMobile` boundary: below it the sidebar is
    // a Sheet and the whole width is the bar's, above it the sidebar is docked
    // and takes 255px away. Both have to hold.
    for (const width of [375, 767, 768]) {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(`/${slug}`);
      await page.waitForLoadState("networkidle");

      const { overflow, controls } = await headerControls(page, width);
      expect(controls.length).toBeGreaterThan(4);
      expect(
        controls.filter((c) => c.offscreen).map((c) => c.label),
        `controls pushed out of a ${width}px viewport`,
      ).toEqual([]);
      expect(
        controls.filter((c) => c.collapsed).map((c) => c.label),
        `controls squeezed at ${width}px`,
      ).toEqual([]);
      expect(overflow, `topbar overflow at ${width}px`).toBe(0);
    }
  });

  test("the breadcrumbs are the one thing that gives way", async ({ page }) => {
    test.setTimeout(120_000);
    const slug = await openProject(page, "crm");

    const breadcrumbWidth = async (width: number) => {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(`/${slug}`);
      await page.waitForLoadState("networkidle");
      return page.evaluate(() => {
        const bc = document.querySelector('[data-slot="breadcrumb"]');
        return bc ? Math.round(bc.getBoundingClientRect().width) : null;
      });
    };

    // Dropped outright below `sm` rather than left as an unreadable sliver.
    // They are the one thing on the bar repeated in the page below.
    expect(await breadcrumbWidth(375)).toBe(0);
    // Present but truncated where there is still something to read: at 768 the
    // docked sidebar leaves the bar 513px, which is not enough for all of it.
    const at768 = await breadcrumbWidth(768);
    expect(at768).toBeGreaterThan(0);
    const at1280 = await breadcrumbWidth(1280);
    expect(at1280).toBeGreaterThan(at768!);
  });

  test("the trigger opens the sheet at 375px, and it can be closed", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const slug = await openProject(page, "sht");

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/${slug}`);
    await page.waitForLoadState("networkidle");

    const trigger = page.getByRole("button", { name: /Expand sidebar/ });
    await expect(sheet(page)).toHaveCount(0);
    await trigger.click();
    await expect(sheet(page)).toBeVisible();

    // `sidebar.tsx` passes `[&>button]:hidden` to `SheetContent`, so the sheet
    // has no close button of its own, and while it is open the modal marks the
    // whole page behind it `aria-hidden` — the trigger included. Escape and the
    // overlay are therefore the only ways out, and both have to work or the
    // sidebar is a one-way door.
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);

    await trigger.click();
    await expect(sheet(page)).toBeVisible();
    // Outside the 18rem (288px) sheet.
    await page.mouse.click(340, 400);
    await expect(sheet(page)).toHaveCount(0);
  });

  /**
   * #1746, from feedback #2077 at 491x929: tapping a nav entry navigated and
   * left the sheet up, so the destination rendered behind an overlay the
   * reader had to dismiss by hand.
   *
   * ⚠️ Matched with `:not([data-closed])`, not by counting the element. Base
   * UI keeps a dismissed sheet mounted through its exit animation, so a
   * plain `toHaveCount(0)` here would be asserting the animation's timing.
   */
  test("a nav entry closes the sheet and lands on the page", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const slug = await openProject(page, "nav");

    await page.setViewportSize({ width: 491, height: 929 });
    await page.goto(`/${slug}/feedback`);
    await page.waitForLoadState("networkidle");

    const openSheet = page.locator(
      '[data-slot="sidebar"][data-mobile="true"]:not([data-closed])',
    );

    await page.getByRole("button", { name: /Expand sidebar/ }).click();
    await expect(openSheet).toBeVisible();

    await openSheet.locator(`a[href="/${slug}/releases"]`).click();

    await page.waitForURL(`**/${slug}/releases`, { timeout: 15_000 });
    await expect(openSheet).toHaveCount(0);
  });

  /**
   * The desktop half of the same fix. `toggleSidebar` branches on `isMobile`
   * and the close-on-navigate has to stay behind that branch: collapsing the
   * docked rail on every click would be a new bug, not a fix.
   */
  test("the docked sidebar survives a nav click", async ({ page }) => {
    test.setTimeout(120_000);
    const slug = await openProject(page, "dsk");

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/${slug}/feedback`);
    await page.waitForLoadState("networkidle");

    const rail = page.locator('[data-slot="sidebar"][data-state]').first();
    await expect(rail).toHaveAttribute("data-state", "expanded");

    await page.locator(`a[href="/${slug}/releases"]`).first().click();
    await page.waitForURL(`**/${slug}/releases`, { timeout: 15_000 });

    await expect(rail).toHaveAttribute("data-state", "expanded");
  });
});
