import { expect, test } from "./_fixtures.ts";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
  setCapability,
} from "./_helpers.ts";

/**
 * Reports.
 *
 * ⚠️ This file exists because nothing rendered the pages. `capabilities.spec.ts`
 * visits `/reports` and asserts the Quests TAB is offered, then stops - so
 * every chart on the page behind it was unexercised, and a component that
 * throws on mount would have passed the whole gate. The convention is one
 * spec per feature; Reports had none.
 */
test.describe("Reports", () => {
  /**
   * The tag breakdown (#Q2083), on Backlog since #Q3016, and the old Quests
   * link landing there: both labels, since one quest produced both bars.
   */
  test("Backlog breaks work down by tag, and an old Quests link lands on it", async ({
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

    await expect(page).toHaveURL(new RegExp(`/${projectSlug}/reports/backlog`));
    await expect(page.getByText("By tag", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("bug", { exact: true })).toBeVisible();
    await expect(page.getByText("regression", { exact: true })).toBeVisible();

    await page.goto(`/${projectSlug}/reports/members`);
    await expect(page).toHaveURL(new RegExp(`/${projectSlug}/reports/team`));
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
   * The Flow tab (#Q3000): the first page to draw the kit's charts, so this is
   * what proves they mount.
   */
  test("Flow draws its charts from real quests", async ({ page }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    await registerAndVerify(
      page,
      `reportsflow${t}@example.com`,
      "ReportsF123!",
    );
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `RF${t}`.slice(0, 20),
    );
    await apiPost(page, "createQuest", {
      projectId,
      title: `Flow${t}`,
      description: "Seeded for the flow tab",
      area: "core",
      priority: "medium",
      objectives: [],
      attachments: [],
    });

    await page.goto(`/${slug}/reports/flow?range=7d`);

    await expect(page.getByText("Cumulative flow")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Aging work in progress")).toBeVisible();
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    // The stacked area drew: a chart that throws takes the page with it, and
    // one that silently renders nothing has no surface.
    // Counted rather than `toBeVisible`: an empty band is a zero-height path.
    await expect(page.locator(".recharts-area-area")).toHaveCount(4);
  });

  /**
   * The Backlog tab (#Q3002).
   */
  test("Backlog breaks down the open work and lists what needs a hand", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    await registerAndVerify(page, `reportsbl${t}@example.com`, "ReportsB123!");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `RL${t}`.slice(0, 20),
    );
    await apiPost(page, "createQuest", {
      projectId,
      title: `Bare${t}`,
      description: "",
      area: "core",
      priority: "medium",
      objectives: [],
      attachments: [],
    });

    await page.goto(`/${slug}/reports/backlog`);

    await expect(page.getByText("Backlog age")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    // A quest with no objectives lands on the hygiene list, as a link.
    await expect(
      page.getByRole("link", { name: new RegExp(`Bare${t}`) }),
    ).toBeVisible();
  });

  /**
   * The Planning tab (#Q3003), on a project that has started nothing yet.
   */
  test("Planning says so when no epic has started", async ({ page }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    await registerAndVerify(page, `reportspl${t}@example.com`, "ReportsP123!");
    const { slug } = await createProjectViaWizard(page, `RP${t}`.slice(0, 20));

    await page.goto(`/${slug}/reports/planning`);

    await expect(page.getByText("Epic timeline")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    await expect(
      page.getByText("No epic has started in this period.").first(),
    ).toBeVisible();
  });

  /**
   * An open release (#Q3004): its burn-up is its own chart, fed by the flow
   * history, so it has to be seen mounting.
   */
  test("Planning draws an open release's burn-up", async ({ page }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    await registerAndVerify(page, `reportsrl${t}@example.com`, "ReportsR123!");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `RR${t}`.slice(0, 20),
    );
    const release = await page.evaluate(
      async ({ projectId }) => {
        const r = await fetch(`/api/createRelease/${projectId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ tag: "1.0.0" }),
        });
        if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
        return (await r.json()) as { id: number };
      },
      { projectId },
    );
    await apiPost(page, "createQuest", {
      projectId,
      title: `Rel${t}`,
      description: "Seeded for the release burn-up",
      area: "core",
      priority: "medium",
      releaseId: release.id,
      objectives: [],
      attachments: [],
    });

    await page.goto(`/${slug}/reports/planning`);

    await expect(page.getByText("Release 1.0.0")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("0/1")).toBeVisible();
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  });

  /**
   * The Support tab (#Q3006), which only a project with Support has.
   */
  test("Support reports on feedback, on a project that has it", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    await registerAndVerify(page, `reportssp${t}@example.com`, "ReportsS123!");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `RU${t}`.slice(0, 20),
    );
    await setCapability(page, projectId, "support");

    await page.goto(`/${slug}/reports/support`);

    await expect(page.getByText("Pending by age")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  });

  /**
   * The Knowledge tab (#Q3007).
   */
  test("Knowledge reports on the project's folios", async ({ page }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    await registerAndVerify(page, `reportskn${t}@example.com`, "ReportsK123!");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `RK${t}`.slice(0, 20),
    );
    await setCapability(page, projectId, "remember");

    await page.goto(`/${slug}/reports/knowledge`);

    await expect(page.getByText("Most revised")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  });

  /**
   * The Team tab (#Q3013): a row per member, sorted by name or load, and no
   * rank anywhere.
   */
  test("Team lists the members and sorts them by load", async ({ page }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    await registerAndVerify(
      page,
      `reportsteam${t}@example.com`,
      "ReportsT123!",
    );
    const { slug } = await createProjectViaWizard(page, `RT${t}`.slice(0, 20));

    await page.goto(`/${slug}/reports/team`);

    const table = page.getByTestId("reports-team");
    await expect(table.getByRole("row")).toHaveCount(2, { timeout: 20_000 });
    await expect(page.getByText("How work arrives")).toBeVisible();
    await expect(page.getByTestId("reports-heatmap")).toBeVisible();
    await expect(
      page.getByTestId("reports-team-explorer").getByText("project_activity"),
    ).toBeVisible();

    await page
      .getByTestId("reports-team-sort")
      .getByRole("button", { name: "By load" })
      .click();
    await expect(table.getByRole("row")).toHaveCount(2);
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  });

  /**
   * The Delivery tab (#Q3008).
   */
  test("Delivery reads DORA's keys on a project that has shipped nothing", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    await registerAndVerify(page, `reportsdl${t}@example.com`, "ReportsD123!");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `RD${t}`.slice(0, 20),
    );
    await setCapability(page, projectId, "ship");

    await page.goto(`/${slug}/reports/delivery`);

    await expect(page.getByText("Change failure rate")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
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
      .getByRole("link", { name: "Backlog" })
      .click();
    await expect(page).toHaveURL(/\/reports\/backlog\?.*range=7d/);
    await expect(page).toHaveURL(/compare=true/);

    // Backlog does not declare a grain: the bar keeps it, disabled.
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
});
