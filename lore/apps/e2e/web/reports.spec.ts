import { expect, test } from "./_fixtures.ts";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * Reports ▸ Quests.
 *
 * ⚠️ This file exists because nothing rendered the page. `capabilities.spec.ts`
 * visits `/reports` and asserts the Quests TAB is offered, then stops - so
 * every chart on the page behind it was unexercised, and a component that
 * throws on mount would have passed the whole gate. The convention is one
 * spec per feature; Reports had none.
 */
test.describe("Reports", () => {
  /**
   * The tag breakdown (#Q2083), reported as "I want completion per tag, to
   * read progress without opening anything".
   *
   * ⚠️ The section says out loud that a quest appears under each of its
   * tags. Every other breakdown on the page partitions the project, so a
   * reader who assumes this one does too will add the bars up and find more
   * quests than exist. That sentence is asserted here rather than left to
   * review, because it is the one thing on the page that stops a number
   * being misread.
   */
  test("Quests breaks work down by tag, and says the bars overlap", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    const projectTitle = `RQ${t}`.slice(0, 20);

    await registerAndVerify(page, `reports${t}@example.com`, "ReportsTest123!");
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    // One quest under two tags, so the axis is doing the thing that makes it
    // worth having: `bug` and `regression` both count it.
    await apiPost(page, "createQuest", {
      projectId,
      title: `Tagged${t}`,
      description: "Seeded for the tag breakdown",
      area: "core",
      priority: "medium",
      tags: ["bug", "regression"],
      objectives: [],
      attachments: [],
    });

    await page.goto(`/${projectSlug}/reports/quests`);

    // The three breakdowns, in the order the page lays them out. Asserting
    // the neighbours too, because the failure this guards against is the new
    // section throwing and taking the page with it.
    await expect(page.getByText("By area", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    const byTag = page.getByText("By tag", { exact: true });
    await expect(byTag).toBeVisible();
    await expect(page.getByText("By priority", { exact: true })).toBeVisible();

    await expect(
      page.getByText(/A quest appears under each of its tags/i),
    ).toBeVisible();

    // The chart drew, and it drew the tags rather than an empty state. Both
    // labels, since one quest produced both bars.
    await expect(page.getByText("bug", { exact: true })).toBeVisible();
    await expect(page.getByText("regression", { exact: true })).toBeVisible();
  });

  /**
   * The Summary tab (#Q2999): the first tab, its lines the enabled
   * capabilities' only, and a line linking to the tab that explains it while
   * keeping the filters.
   */
  test("Summary is the first tab and shows the project's capabilities", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    await registerAndVerify(page, `reportssum${t}@example.com`, "ReportsS123!");
    const { slug } = await createProjectViaWizard(page, `RS${t}`.slice(0, 20));

    await page.goto(`/${slug}/reports?range=7d`);

    await expect(
      page.getByTestId("reports-tabs").getByRole("link").first(),
    ).toHaveText("Summary", { timeout: 20_000 });
    await expect(page.getByText("Quests completed")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Copy as status update" }),
    ).toBeVisible();
  });

  /**
   * The filter bar (#Q2996). The state lives in the URL, so a link is
   * shareable, a reload keeps it, and moving between tabs carries it.
   */
  test("the filter bar round-trips through the URL and across tabs", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    await registerAndVerify(page, `reportsbar${t}@example.com`, "ReportsB123!");
    const { slug } = await createProjectViaWizard(page, `RB${t}`.slice(0, 20));

    await page.goto(`/${slug}/reports?range=7d&compare=true&priority=nope`);
    const bar = page.getByTestId("reports-filter-bar");
    await expect(bar).toBeVisible({ timeout: 20_000 });
    await expect(bar.getByText("Last 7 days")).toBeVisible();

    await page
      .getByTestId("reports-tabs")
      .getByRole("link", { name: "Quests" })
      .click();
    await expect(page).toHaveURL(/\/reports\/quests\?.*range=7d/);
    await expect(page).toHaveURL(/compare=true/);

    // Quests does not declare a grain: the bar keeps it, disabled.
    await expect(bar.getByLabel("Grain")).toBeDisabled();

    await page.reload();
    await expect(bar.getByText("Last 7 days")).toBeVisible({ timeout: 20_000 });

    // The write path: picking a value is what moves the URL, and it keeps the
    // rest of the query.
    await bar.getByRole("combobox", { name: "Period" }).click();
    await page.getByRole("option", { name: "Last 90 days" }).click();
    await expect(page).toHaveURL(/range=90d/);
    await expect(page).toHaveURL(/compare=true/);
    await expect(bar.getByText("Last 90 days")).toBeVisible();
  });

  /**
   * A project with tagged quests is the interesting case; a project with none
   * is the one that ships to everybody who has never used a tag, and an empty
   * chart area is what they see.
   */
  test("the tag section says so when nothing carries a tag", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    const projectTitle = `RE${t}`.slice(0, 20);

    await registerAndVerify(
      page,
      `reportsempty${t}@example.com`,
      "ReportsE123!",
    );
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    await apiPost(page, "createQuest", {
      projectId,
      title: `Bare${t}`,
      description: "No tags on this one",
      area: "core",
      priority: "medium",
      objectives: [],
      attachments: [],
    });

    await page.goto(`/${projectSlug}/reports/quests`);

    await expect(page.getByText("By tag", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    // ⚠️ An untagged quest belongs to NO tag, and must not become an
    // "Unassigned" bar the way an area does: an area is one value a quest
    // always has, a tag list can legitimately be empty.
    await expect(page.getByText("No quest carries a tag yet")).toBeVisible();
  });
});
