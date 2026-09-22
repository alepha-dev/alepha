import { expect, test } from "./_fixtures.ts";
import { apiPost, createProjectViaWizard, registerAndVerify } from "./_helpers";

/**
 * The quest page's rail, laid out (#Q2424).
 *
 * An e2e rather than a browser spec because the claim is a height: jsdom has
 * no layout, so "every row is as tall as the next" can only be measured in a
 * real browser.
 */
test.describe("Quest rail", () => {
  test("every row is one height, Tags sits on its label's line, and Reminder waits for an assignee", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    await registerAndVerify(page, `rail${t}@example.com`, "RailTest123!");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `RA${t}`.slice(0, 20),
      { options: { work: ["releases", "reminder"] } },
    );

    const release = await page.evaluate(async (projectId) => {
      const r = await fetch(`/api/createRelease/${projectId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tag: "0.1.0" }),
      });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return (await r.json()) as { id: number };
    }, projectId);

    const quest = await apiPost<{ id: number; shortId: number }>(
      page,
      "createQuest",
      {
        projectId,
        title: `Rail${t}`,
        description: "",
        area: "lore/quests",
        priority: "high",
        objectives: [],
        attachments: [],
        tags: ["bug", "ui"],
        releaseId: release.id,
      },
    );

    await page.goto(`/${slug}/quests/${quest.shortId}`);
    await page.waitForLoadState("networkidle");

    const rows = page.locator('[data-slot="quest-rail-row"]');
    const tagsRow = rows.filter({ hasText: "Tags" });
    await expect(tagsRow).toBeVisible({ timeout: 10_000 });
    await expect(rows.filter({ hasText: "Release" })).toBeVisible();

    // Nobody has accepted it, so a reminder cannot be set, and the rail
    // draws nothing for it: not a heading over a sentence saying why.
    await expect(page.getByText("Reminder", { exact: true })).toHaveCount(0);

    // One height for every row, the tall values included: a select trigger
    // for Release, chips for Tags, an avatar for Assigned.
    const heights = await rows.evaluateAll((els) =>
      els.map((el) => ({
        text: (el.textContent ?? "").slice(0, 20),
        // `clientHeight`, not the bounding box: it leaves out the 1px
        // divider every row but the last one carries.
        height: el.clientHeight,
      })),
    );
    expect(heights.length).toBeGreaterThanOrEqual(6);
    // Status is plain text: the height every other row is held to.
    const expected = heights[0].height;
    expect(heights).toEqual(
      heights.map((row) => ({ text: row.text, height: expected })),
    );

    // The chips share the label's line rather than sitting under it.
    const label = await tagsRow
      .getByText("Tags", { exact: true })
      .boundingBox();
    const chip = await tagsRow.getByText("bug", { exact: true }).boundingBox();
    expect(label && chip).toBeTruthy();
    expect(Math.abs(label!.y - chip!.y)).toBeLessThanOrEqual(4);
    expect(chip!.x).toBeGreaterThan(label!.x + label!.width);

    // Accepted, the block is there.
    await page.evaluate(async (id) => {
      const r = await fetch(`/api/acceptQuest/${id}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    }, quest.id);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Reminder", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });
});
