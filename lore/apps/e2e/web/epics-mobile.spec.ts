import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  createProjectViaWizard,
  registerAndVerify,
  setCapability,
} from "./_helpers.ts";

/**
 * The Epics list on a phone (#Q4551, feedback #P2563), driven at 393x663:
 * the Safari iOS viewport the report was filed from.
 *
 * A draft epic with open review items carried the full "3 review questions
 * open" beside its title, `shrink-0` so the title truncates first. In a
 * column about 192px wide that left the title `#…`. Below `md` the badge is
 * now the icon and the count, and the title keeps its reference and a start.
 *
 * An e2e because the claim is a width: jsdom has no layout.
 */

/**
 * One JSON call through the page's own session, failing loudly.
 */
const call = async <T>(page: Page, path: string, body: unknown): Promise<T> =>
  (await page.evaluate(
    async ({ path, body }) => {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
      return r.json();
    },
    { path, body },
  )) as T;

test.describe("Epics list on a phone", () => {
  test("at 393x663 the epic reference and title stay readable beside a review badge", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `epm${t}@example.com`, "GoodPassw0rd");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `EM${t}`.slice(0, 20),
    );
    await setCapability(page, projectId, "plan", { options: { epics: true } });

    const blocked = await call<{ id: number; number: number }>(
      page,
      `/api/createEpic/${projectId}`,
      { title: "Quest status Draft: not ready to be taken, and the end" },
    );
    await call(page, `/api/createEpicReview/${blocked.id}`, {
      summary: "One blocker.",
      items: [{ kind: "blocker", title: "Which table holds it?" }],
    });
    const asked = await call<{ id: number; number: number }>(
      page,
      `/api/createEpic/${projectId}`,
      { title: "GitHub integration: a GitHub App per instance, events in" },
    );
    await call(page, `/api/createEpicReview/${asked.id}`, {
      summary: "Three questions.",
      items: [
        { kind: "question", title: "One?" },
        { kind: "question", title: "Two?" },
        { kind: "question", title: "Three?" },
      ],
    });

    await page.setViewportSize({ width: 393, height: 663 });
    await page.goto(`/${slug}/epics`);
    await page.waitForLoadState("networkidle");

    for (const [epic, testId, count, sentence, start] of [
      [blocked, "epic-open-blockers", "1", "1 review blocker open", "Quest"],
      [asked, "epic-open-questions", "3", "3 review questions open", "GitHub"],
    ] as const) {
      await test.step(`#E${epic.number}: the title is readable beside its badge`, async () => {
        const badge = page.getByTestId(`${testId}-${epic.number}`);
        await expect(badge).toBeVisible({ timeout: 15_000 });
        // The sentence is still the badge's text and its tooltip, for a
        // screen reader and a hover, with the singular for one.
        await expect(badge).toHaveText(sentence);
        await expect(badge).toHaveAttribute("title", sentence);

        const link = page
          .getByTestId(`epic-title-line-${epic.number}`)
          .getByRole("link");
        const [linkBox, badgeBox] = await Promise.all([
          link.boundingBox(),
          badge.boundingBox(),
        ]);
        // The badge is the icon and the count, not the sentence.
        expect(badgeBox!.width).toBeLessThan(40);
        // The title keeps room for its reference and the start of its name:
        // `#E1 - Quest` measures about 90px at this size.
        expect(linkBox!.width).toBeGreaterThan(100);
        await expect(link).toContainText(`#E${epic.number}`);
        await expect(link).toContainText(start);

        const after = await badge.evaluate(
          (el) => getComputedStyle(el, "::after").content,
        );
        // The count, with an empty alternative text for screen readers.
        expect(after).toBe(`"${count}" / ""`);
      });
    }

    await test.step("from md up the badge is the sentence again", async () => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const badge = page.getByTestId(`epic-open-questions-${asked.number}`);
      const box = await badge.boundingBox();
      expect(box!.width).toBeGreaterThan(100);
      const after = await badge.evaluate(
        (el) => getComputedStyle(el, "::after").content,
      );
      expect(after).toBe("none");
    });
  });
});
