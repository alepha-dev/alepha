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
