import { expect, test } from "./_fixtures.ts";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * `AlephaTable` on a phone, driven at 412x915 - the real Chrome-on-Android
 * viewport feedback #2106 was filed from, not a round number.
 *
 * The table is `@alepha/ui`, but its two layouts are decided by
 * `useIsMobile()` at runtime, so only a real viewport can tell them apart: a
 * unit render sees whichever branch jsdom's `matchMedia` stub reports, and the
 * regression this guards is precisely that the wrong branch renders. The
 * Activity page is the surface the report names, and its filter bar is the
 * worst case - three selects, which is what cost several rows of height above
 * the first row of data.
 *
 * The desktop half of every assertion is here too, because the reporter's
 * opening line is that the table is much better than it was: the risk in this
 * change is undoing that above the breakpoint, not failing to help below it.
 */
test.describe("AlephaTable on a phone", () => {
  test("filters move into a dialog and the footer fits one line", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `tbl${t}@example.com`, "GoodPassw0rd");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `TB${t}`.slice(0, 20),
    );

    const questTitle = `Filed${t}`;
    await apiPost(page, "createQuest", {
      projectId,
      title: questTitle,
      description: "seeded",
      area: "Main",
      priority: "medium",
      objectives: [],
      attachments: [],
    });

    const filterTrigger = page.locator('[data-slot="dialog-trigger"]').first();
    // The bar's own form, which is the element that must NOT exist below the
    // breakpoint. Matched on the layout classes `AlephaTable` gives it rather
    // than on a test id, so a rewrite of the bar fails this rather than
    // silently passing against a hook nobody renders any more.
    const filterBar = page.locator("form.flex.flex-1.flex-wrap");

    await test.step("at 412x915 the bar is gone and a filter button replaces it", async () => {
      await page.setViewportSize({ width: 412, height: 915 });
      await page.goto(`/${slug}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(questTitle)).toBeVisible({ timeout: 15_000 });

      await expect(filterBar).toHaveCount(0);
      await expect(filterTrigger).toBeVisible();
    });

    await test.step("the dialog holds the table's own filter form, once", async () => {
      await filterTrigger.click();
      const dialog = page.locator('[data-slot="dialog-content"]');
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      // Exactly one filter form in the whole document. Two would mean the
      // bar was CSS-hidden rather than not rendered, which puts two inputs on
      // every field - duplicate ids, and two controls writing one model.
      await expect(dialog.locator("form")).toHaveCount(1);
      await expect(page.locator("form")).toHaveCount(1);
    });

    await test.step("a filter set in the dialog reaches fetch, while it is still open", async () => {
      // Armed before the click, so this asserts the REQUEST and not the DOM
      // settling afterwards - the same reasoning as `activity.spec.ts`.
      const request = page.waitForResponse(
        (response) =>
          response.url().includes("/api/") && response.status() === 200,
        { timeout: 15_000 },
      );

      const dialog = page.locator('[data-slot="dialog-content"]');
      await dialog
        .getByRole("combobox")
        .filter({ hasText: /All resources/i })
        .click();
      await page.getByRole("option", { name: "Folio", exact: true }).click();
      await request;

      // ⚠️ The select's own popup outlives the choice inside a dialog, and it
      // is a portal that covers the footer: without this, clicking Done hits
      // the option list instead. Not a product bug - a `role=listbox` in a
      // portal is exactly what a reader would tap away from - but the spec
      // has to do the tapping away.
      await page.keyboard.press("Escape");
      await expect(page.getByRole("listbox")).toHaveCount(0, {
        timeout: 10_000,
      });

      // Still open. The desktop bar applies as you go, and a dialog that
      // waited for Done would give the same controls a second behaviour
      // decided by the width of the screen.
      await expect(dialog).toBeVisible();
    });

    await test.step("the trigger says how many filters are active", async () => {
      await page.getByRole("button", { name: /done/i }).click();
      await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);

      // Nothing wrote a folio here, so the seeded quest must be gone: the
      // badge is only worth reading if the filter it counts really applied.
      await expect(page.getByText(questTitle)).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(filterTrigger).toContainText("1");
    });

    await test.step("the footer is one line: no size picker, no page numbers", async () => {
      const footer = await page.evaluate(() => {
        const bar = Array.from(document.querySelectorAll("div.bg-muted")).find(
          (d) => (d.textContent ?? "").includes("Page"),
        ) as HTMLElement | undefined;
        if (!bar) return null;
        return {
          text: (bar.textContent ?? "").trim(),
          // One distinct `top` among the children is what "one line" means
          // here: the bar is `flex-wrap`, so a second row is a second top.
          rows: new Set(
            Array.from(bar.children).map((c) =>
              Math.round(c.getBoundingClientRect().top),
            ),
          ).size,
          comboboxes: bar.querySelectorAll("[role=combobox]").length,
        };
      });

      expect(footer).not.toBeNull();
      expect(footer!.rows).toBe(1);
      expect(footer!.comboboxes, "no page-size picker on a phone").toBe(0);
      expect(footer!.text).toMatch(/^Page \d/);
      // The row range is the half that goes; "Page 1 of 3" is what stays.
      expect(footer!.text).not.toContain("·");
    });

    await test.step("above the breakpoint nothing moved", async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/${slug}`);
      await page.waitForLoadState("networkidle");

      await expect(filterBar).toHaveCount(1);
      await expect(filterTrigger).toHaveCount(0);

      // The filter chosen on the phone is still applied here - it is
      // persisted per table, and the dialog is only where the controls live,
      // not a second set of values. Clearing it from the desktop bar's own
      // Reset brings the row back, which is the round trip that proves the
      // two layouts drive one form.
      await expect(page.getByText(questTitle)).toHaveCount(0);
      await page.getByRole("button", { name: /reset filters/i }).click();
      await expect(page.getByText(questTitle)).toBeVisible({ timeout: 15_000 });

      const footer = await page.evaluate(() => {
        const bar = Array.from(document.querySelectorAll("div.bg-muted")).find(
          (d) => (d.textContent ?? "").includes("Page"),
        ) as HTMLElement | undefined;
        return bar
          ? {
              text: (bar.textContent ?? "").trim(),
              comboboxes: bar.querySelectorAll("[role=combobox]").length,
            }
          : null;
      });
      expect(footer!.comboboxes, "the size picker is a desktop control").toBe(
        1,
      );
      expect(footer!.text).toContain("·");
    });
  });
});
