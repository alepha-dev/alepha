import { expect, test } from "./_fixtures.ts";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * The Activity page, at `/activity`.
 *
 * ⚠️ It held the project root until #Q2104 and does not any more - the
 * dashboard does. What that first half of this spec is for is unchanged
 * though: which component a route renders is a unit concern, but "the page at
 * this path is the feed, and the URL does not move under the reader" is a
 * claim about the real router, the real sidebar and the real project layout.
 * `e2e/dashboard.spec.ts` pins the root's own destination from the other
 * side.
 *
 * Since the page became an `AlephaTable` over scoped `audits` rows, the last
 * step also pins the half that no unit test can: that a filter is answered by
 * the SERVER. The unit specs can only assert that the query was built; only a
 * real request proves it was honoured.
 */
test.describe("Activity", () => {
  test("lives at /activity, and reports what moved", async ({ page }) => {
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

    await test.step("Activity is at /activity, and the URL does not move", async () => {
      await page.goto(`/${slug}/activity`);
      await page.waitForLoadState("networkidle");

      // ⚠️ Activity moved off the project root when the dashboard took it
      // (#Q2104), exactly as the quest list moved off it when Activity did.
      // The URL must not move either way: this page RENDERS at `/activity`
      // and nothing redirects to or from it. A redirect is the shape #156 was
      // about, and a per-project landing setting is the one feedback #2066
      // removed.
      expect(new URL(page.url()).pathname).toBe(`/${slug}/activity`);
      // The BREADCRUMB leaf, not a heading. The page had an `<h1>` reading
      // Activity until feedback #2090; it was removed precisely because this
      // crumb already says the word, and no sibling list page carries one.
      // Asserting here keeps the step proving what it always proved - which
      // page rendered at the root - from the surface that survived.
      await expect(
        page
          .getByRole("navigation", { name: "breadcrumb" })
          .getByText("Activity"),
      ).toBeVisible({ timeout: 15_000 });
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
      // ⚠️ `/activity`, not the bare slug: that href is the DASHBOARD's since
      // #Q2104, and clicking it would leave this spec asserting Activity's
      // breadcrumb on the board.
      await page.locator(`a[href="/${slug}/activity"]`).first().click();
      await page.waitForURL(`**/${slug}/activity`, { timeout: 15_000 });
      // The breadcrumb leaf again, for the reason given on the first step.
      await expect(
        page
          .getByRole("navigation", { name: "breadcrumb" })
          .getByText("Activity"),
      ).toBeVisible({ timeout: 15_000 });
    });

    await test.step("a resource filter re-queries the server and narrows the table", async () => {
      await page.goto(`/${slug}/activity`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(questTitle)).toBeVisible({ timeout: 15_000 });

      // Every filter on this page is an indexed column, so picking one is a
      // ROUND TRIP and not a client-side narrowing of rows already fetched.
      // That is the whole difference between this table and the feed it
      // replaced, and it is what this step exists to pin: arming the wait
      // before the click is what makes it an assertion about the request
      // rather than about the DOM settling.
      const request = page.waitForResponse(
        (response) =>
          response.url().includes("/api/") && response.status() === 200,
        { timeout: 15_000 },
      );

      // Base UI renders a `Control` as a role=combobox BUTTON, not a native
      // <select>, so the option is reached by opening the popover.
      await page
        .getByRole("combobox")
        .filter({ hasText: /All resources/i })
        .click();
      await page.getByRole("option", { name: "Folio", exact: true }).click();
      await request;

      // Nothing wrote a folio in this project, so the quest row must go: a
      // filter that left it there would be narrowing nothing.
      await expect(page.getByText(questTitle)).toHaveCount(0, {
        timeout: 15_000,
      });
    });
  });
});
