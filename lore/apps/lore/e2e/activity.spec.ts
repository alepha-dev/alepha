import { expect, test } from "@playwright/test";

import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * The Activity page, and the fact that it is the project's landing page.
 *
 * The second half is the one that needs an e2e. Which component a route
 * renders is a unit concern, but "a bare `/:projectSlug` opens Activity and
 * not the quest list" is a claim about the real router, the real sidebar and
 * the real project layout, and it is the claim the whole change rests on.
 * `test/dashboard-links.spec.ts` pins the quest list's new path from the
 * other side.
 */
test.describe("Activity", () => {
  test("is what a bare project URL opens, and reports what moved", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    const email = `activity${t}@example.com`;
    const password = "GoodPassw0rd";

    await registerAndVerify(page, email, password);
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `AC${t}`.slice(0, 20),
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

    await test.step("a bare project URL lands on Activity", async () => {
      await page.goto(`/${slug}`);
      await page.waitForLoadState("networkidle");

      // The URL must not have moved: Activity RENDERS at the root, it does
      // not redirect there. A redirect is the shape #156 was about, and a
      // per-project landing setting is the one feedback #2066 removed.
      expect(new URL(page.url()).pathname).toBe(`/${slug}`);
      await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible(
        { timeout: 15_000 },
      );
    });

    await test.step("the quest that was just filed shows up", async () => {
      // `includeOwn` is true on this page, unlike over MCP: on your own
      // project you are the actor, and with it off this assertion would be
      // the empty state.
      await expect(page.getByText(questTitle)).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("the quest list is still reachable, at /quests", async () => {
      await page.goto(`/${slug}/quests`);
      await page.waitForLoadState("networkidle");
      await expect(
        page.locator("[data-testid=quests-table]").getByText(questTitle),
      ).toHaveCount(1, { timeout: 15_000 });
    });

    await test.step("the sidebar entry goes back to Activity", async () => {
      await page.locator(`a[href="/${slug}"]`).first().click();
      await page.waitForURL(`**/${slug}`, { timeout: 15_000 });
      await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible(
        { timeout: 15_000 },
      );
    });

    await test.step("a narrow window empties the feed rather than breaking it", async () => {
      // The quest was filed seconds ago, so 3h still contains it; what this
      // guards is that switching the window re-queries and re-renders at all
      // rather than throwing. The empty case is exercised by the unit specs,
      // where the clock can be moved.
      await page.getByRole("button", { name: "3h" }).click();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(questTitle)).toBeVisible({
        timeout: 15_000,
      });
    });
  });
});
