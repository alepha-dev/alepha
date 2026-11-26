import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import { apiPost, createProjectViaWizard, registerAndVerify } from "./_helpers";

/**
 * The quest page on a phone (#Q4418, feedback #P2524).
 *
 * At 411x845 the page left the body a strip: the left column had
 * `overflow-x-hidden`, which CSS turns into a scroller on both axes, so the
 * body scrolled inside 456px while the rail stood still under it, and the
 * sticky header above held a long title over five lines (171px). The body
 * got about 285px of an 845px screen.
 *
 * An e2e because the claim is a share of the screen: jsdom has no layout.
 */
test.describe("Quest page on a phone", () => {
  const TITLE =
    "Quest page on a phone: the sticky header and the rail leave the body only a strip of the screen";

  const openQuest = async (page: Page) => {
    const t = Date.now();
    await registerAndVerify(page, `qm${t}@example.com`, "MobileTest123!");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `QM${t}`.slice(0, 20),
    );
    const quest = await apiPost<{ shortId: number }>(page, "createQuest", {
      projectId,
      title: TITLE,
      description: Array.from(
        { length: 30 },
        (_, i) =>
          `Paragraph ${i}: the body of the quest, long enough to scroll.`,
      ).join("\n\n"),
      area: "lore/quests",
      priority: "medium",
      objectives: [
        { title: "One", completed: false },
        { title: "Two", completed: false },
      ],
      attachments: [],
      tags: ["bug", "ui", "mobile"],
    });
    await page.goto(`/${slug}/quests/${quest.shortId}`);
    await expect(page.getByTestId("quest-header")).toBeVisible();
    await expect(page.getByText("Paragraph 29:")).toBeAttached();
    // The description renders again once the page's reads settle, which
    // replaces the nodes a scroll would aim at.
    await page.waitForLoadState("networkidle");
  };

  /**
   * Samples the screen under the shell's topbar every 10px down its middle
   * and says what each point lands on: the quest body, the quest header, the
   * rail, or anything else.
   */
  const screenShare = (page: Page) =>
    page.evaluate(() => {
      // The shell's topbar: the first header in `main` that is not the
      // quest's own.
      const topbar = document.querySelector(
        'main header:not([data-testid="quest-header"])',
      );
      const top = Math.ceil(topbar?.getBoundingClientRect().bottom ?? 0);
      const x = Math.round(window.innerWidth / 2);
      const share = { body: 0, header: 0, rail: 0, other: 0, total: 0 };
      for (let y = top + 1; y < window.innerHeight; y += 10) {
        const el = document.elementFromPoint(x, y);
        share.total++;
        if (el?.closest('[data-testid="quest-header"]')) share.header++;
        else if (el?.closest('[data-testid="quest-rail"]')) share.rail++;
        else if (el?.closest('[data-testid="quest-body"]')) share.body++;
        else share.other++;
      }
      return share;
    });

  test("at 411x845, scrolled into the body, the body gets the screen", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 411, height: 845 });
    await openQuest(page);

    // The rail is below the body, in the same scroll: not standing on the
    // screen at the top of a long quest.
    const rail = page.getByTestId("quest-rail");
    await expect(rail).not.toBeInViewport();

    // Scroll into the middle of the description.
    // Retried: a scroll made while the page is still settling after
    // hydration can be reset by its next render.
    const paragraph = page.getByText("Paragraph 12:");
    await expect(async () => {
      await paragraph.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await expect(paragraph).toBeInViewport({ timeout: 500 });
      await expect(page.getByTestId("quest-header")).not.toBeInViewport({
        timeout: 500,
      });
    }).toPass({ timeout: 10_000 });

    const share = await screenShare(page);
    // Nothing pinned over the body, at the top or at the bottom.
    expect(share.header).toBe(0);
    expect(share.rail).toBe(0);
    expect(share.body / share.total).toBeGreaterThan(0.9);

    // The rail is still there, reached by scrolling past the body.
    await rail.scrollIntoViewIfNeeded();
    await expect(rail).toBeInViewport();
  });

  test("at 1440x900 the header stays pinned and the rail stands beside the body", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openQuest(page);

    const header = page.getByTestId("quest-header");
    const rail = page.getByTestId("quest-rail");
    const before = await header.boundingBox();

    const last = page.getByText("Paragraph 29:");
    await expect(async () => {
      await last.scrollIntoViewIfNeeded({ timeout: 500 });
      await expect(last).toBeInViewport({ timeout: 500 });
    }).toPass({ timeout: 10_000 });

    // Pinned: scrolling the body leaves the header on screen, and the rail,
    // a column beside the body, did not move.
    await expect(header).toBeInViewport();
    const after = await header.boundingBox();
    expect(after!.y).toBeLessThanOrEqual(before!.y);
    expect(after!.y).toBeGreaterThanOrEqual(0);
    const railBox = await rail.boundingBox();
    const bodyBox = await page.getByTestId("quest-body").boundingBox();
    expect(railBox!.x).toBeGreaterThanOrEqual(bodyBox!.x + bodyBox!.width);
    expect(railBox!.width).toBe(308);
    expect(await header.evaluate((el) => getComputedStyle(el).position)).toBe(
      "sticky",
    );
  });
});
