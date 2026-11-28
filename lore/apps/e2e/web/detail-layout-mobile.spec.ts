import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  createProjectViaWizard,
  registerAndVerify,
  setCapability,
} from "./_helpers.ts";

/**
 * A detail page's toolbar on a phone (#Q4550, feedback #P2562), driven at
 * 393x663: the Safari iOS viewport the report was filed from.
 *
 * The epic page is the worst case `DetailLayout` has, because it carries the
 * most actions. Its actions kept their full width and left the tab strip
 * about 220px, which showed `Over` of `Overview` and put the four other tabs
 * behind a scroll iOS draws no scrollbar for. Below `md` the strip is now a
 * menu button naming the open tab.
 *
 * An e2e because the claim is about what fits on the screen: jsdom has no
 * layout.
 */
test.describe("Detail page toolbar on a phone", () => {
  test("at 393x663 every tab is reachable and the primary action stays on screen", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `dlm${t}@example.com`, "GoodPassw0rd");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `DL${t}`.slice(0, 20),
    );
    await setCapability(page, projectId, "plan", { options: { epics: true } });
    const epic = await page.evaluate(async (projectId) => {
      const r = await fetch(`/api/createEpic/${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title: "A draft epic on a phone" }),
      });
      if (!r.ok) throw new Error(`createEpic ${r.status} ${await r.text()}`);
      return (await r.json()) as { number: number };
    }, projectId);

    await page.setViewportSize({ width: 393, height: 663 });
    await page.goto(`/${slug}/epics/${epic.number}`);
    await page.waitForLoadState("networkidle");

    const menu = page.locator('[data-slot="detail-tab-menu"]');
    const ready = page.getByRole("button", { name: "Mark as ready" });

    await test.step("the open tab is named in full, beside the primary action", async () => {
      await expect(menu).toBeVisible({ timeout: 15_000 });
      await expect(menu).toContainText("Overview");
      // The strip is not on the page at this width.
      await expect(page.locator('[data-slot="segmented"]')).toBeHidden();

      await expect(ready).toBeVisible();
      const edit = page.getByRole("button", { name: "Edit" });
      const more = page.getByRole("button", { name: "More actions" });
      const boxes = await Promise.all(
        [menu, edit, ready, more].map((it) => it.boundingBox()),
      );
      // All wholly inside the viewport, so none is clipped.
      for (const box of boxes) {
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(393);
      }

      // The … menu opens and its items are on screen.
      await more.click();
      const shelve = page.getByRole("menuitem").first();
      await expect(shelve).toBeVisible();
      const shelveBox = await shelve.boundingBox();
      expect(shelveBox!.x + shelveBox!.width).toBeLessThanOrEqual(393);
      await page.keyboard.press("Escape");
      await expect(shelve).toBeHidden();
      // The page itself does not scroll sideways.
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    await test.step("the menu lists every tab, and picking one opens it", async () => {
      await menu.click();
      const items = page.getByRole("menuitemradio");
      await expect(items).toHaveCount(6);
      for (const label of [
        "Overview",
        "Quests",
        "Flow",
        "Review",
        "Folios",
        "Activity",
      ]) {
        const item = items.filter({ hasText: label });
        await expect(item).toBeVisible();
        const box = await item.boundingBox();
        expect(box!.x + box!.width).toBeLessThanOrEqual(393);
      }
      await items.filter({ hasText: "Activity" }).click();
      await expect(page).toHaveURL(/tab=activity/);
      await expect(menu).toContainText("Activity");
    });

    await test.step("the primary action is clickable", async () => {
      await ready.click();
      // Marking a draft ready asks first, then the status leaves draft and
      // the button is gone.
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Mark as ready" }).click();
      await expect(ready).toHaveCount(0, { timeout: 15_000 });
    });

    await test.step("a use case's page gets the same menu", async () => {
      await setCapability(page, projectId, "plan", {
        options: { epics: true, requirements: true },
      });
      const url = (await apiPath(page, "createUseCase")).replace(
        ":projectId",
        String(projectId),
      );
      const useCase = await page.evaluate(async (url) => {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ title: "Apply a promo code" }),
        });
        if (!r.ok)
          throw new Error(`createUseCase ${r.status} ${await r.text()}`);
        return (await r.json()) as { number: number };
      }, url);
      await page.goto(`/${slug}/requirements/use-cases/${useCase.number}`);
      await page.waitForLoadState("networkidle");
      await expect(menu).toBeVisible({ timeout: 15_000 });
      // The toolbar's strip is the first segmented control on the page: a
      // use case's Scenario card has a Steps/Lanes one of its own.
      await expect(
        page.locator('[data-slot="segmented"]').first(),
      ).toBeHidden();
      const box = await menu.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(393);
      await menu.click();
      const items = page.getByRole("menuitemradio");
      // `count()` does not wait: the menu is open once its first item shows.
      await expect(items.first()).toBeVisible();
      expect(await items.count()).toBeGreaterThan(1);
      for (const item of await items.all()) {
        const itemBox = await item.boundingBox();
        expect(itemBox!.x + itemBox!.width).toBeLessThanOrEqual(393);
      }
      // The tab's label, without the count a tab may carry after it.
      const label = (await items.last().innerText()).trim().split(/\s/)[0]!;
      await items.last().click();
      await expect(menu).toContainText(label);
    });

    await test.step("from md up the strip is back and the menu is gone", async () => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect(
        page.locator('[data-slot="segmented"]').first(),
      ).toBeVisible();
      await expect(menu).toBeHidden();
    });
  });
});
