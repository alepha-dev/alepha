import { expect, type Page, test } from "@playwright/test";

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
});
