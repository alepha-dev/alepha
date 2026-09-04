import { expect, test } from "./_fixtures.ts";
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
 *
 * Since the page became an `AlephaTable` over scoped `audits` rows, the last
 * step also pins the half that no unit test can: that a filter is answered by
 * the SERVER. The unit specs can only assert that the query was built; only a
 * real request proves it was honoured.
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
      await page.locator(`a[href="/${slug}"]`).first().click();
      await page.waitForURL(`**/${slug}`, { timeout: 15_000 });
      // The breadcrumb leaf again, for the reason given on the first step.
      await expect(
        page
          .getByRole("navigation", { name: "breadcrumb" })
          .getByText("Activity"),
      ).toBeVisible({ timeout: 15_000 });
    });

    await test.step("a resource filter re-queries the server and narrows the table", async () => {
      await page.goto(`/${slug}`);
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
