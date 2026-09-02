import { expect, type Page, test } from "@playwright/test";

import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * A raw-path POST for the one action whose parameter lives in the path:
 * `createRelease` takes the project id as `/api/createRelease/:projectId`,
 * and `apiPost` has nowhere to put it.
 */
const post = async <T>(page: Page, path: string, body: unknown): Promise<T> =>
  (await page.evaluate(
    async ({ path, body }) => {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return r.json();
    },
    { path, body },
  )) as T;

/**
 * Bulk triage from the quest list: select rows, pick a release, and both
 * rows carry it. The part worth an e2e rather than a browser spec is the
 * whole chain: the checkbox column exists because the table was handed bulk
 * actions, the menu's items come from the releases atom the project loader
 * filled, and the writes go out as one batch and come back on a refresh.
 */
test.describe("Quests, bulk actions", () => {
  test("adds two selected quests to a release", async ({ page }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `qbulk${t}@example.com`, "GoodPassw0rd");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `QB${t}`.slice(0, 20),
    );

    for (const title of [`First${t}`, `Second${t}`]) {
      await apiPost(page, "createQuest", {
        projectId,
        title,
        description: "seeded",
        area: "Main",
        priority: "medium",
        objectives: [],
        attachments: [],
      });
    }
    await post(page, `/api/createRelease/${projectId}`, { tag: "0.1.0" });

    await page.goto(`/${slug}/`);
    await expect(page.locator("tbody tr")).toHaveCount(2, { timeout: 15_000 });

    await test.step("select both rows", async () => {
      const boxes = page.getByRole("checkbox", { name: "Select row" });
      await boxes.nth(0).click();
      await boxes.nth(1).click();
      await expect(page.getByText("2 selected")).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("pick the release from the menu", async () => {
      // Armed BEFORE the pick: the two updates leave as one `/api/_batch`
      // (or as a single direct call), and the assertion below reads a
      // refreshed list, so the write has to be known to have landed.
      const written = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          (response.url().includes("/api/_batch") ||
            response.url().includes("/api/updateQuestById")) &&
          response.ok(),
      );
      await page.getByRole("button", { name: /Add to release/ }).click();
      await page.getByRole("menuitem", { name: "0.1.0" }).click();
      await written;
    });

    await test.step("both rows carry the release", async () => {
      // The Release column starts hidden, like `linked`: show it to read it.
      await page.getByRole("button", { name: "Toggle columns" }).click();
      await page.getByRole("menuitemcheckbox", { name: "Release" }).click();
      await page.keyboard.press("Escape");

      await expect(page.locator("tbody").getByText("0.1.0")).toHaveCount(2, {
        timeout: 15_000,
      });
      // And the selection was cleared behind the write.
      await expect(page.getByText("2 selected")).toHaveCount(0);
    });
  });
});
