import { expect, test } from "@playwright/test";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * The merge, end to end.
 *
 * This is the behaviour the whole rework exists for: renaming an area
 * onto a name that already exists is a MERGE, not an error and not a
 * duplicate. The old `renameArea` collapsed the quests correctly and
 * still left two identical entries in the picker forever, which is
 * exactly the failure a unit test on the service would not have shown a
 * person.
 */
test.describe("Areas", () => {
  test("an area can be described, then merged into an existing one", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    const email = `area${t}@example.com`;
    const password = "GoodPassw0rd";

    await registerAndVerify(page, email, password);
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `Ar${t}`.slice(0, 20),
    );

    // Two areas differing only in case — the production duplicate that
    // motivated the feature (`folio` vs `Folio`).
    for (const [title, area] of [
      [`Lower${t}`, "folio"],
      [`Upper${t}`, "Folio"],
    ] as const) {
      await apiPost(page, "createQuest", {
        projectId,
        title,
        description: "Seeded for the area merge",
        area,
        priority: "medium",
        difficulty: 2,
        objectives: [],
        attachments: [],
      });
    }

    await page.goto(`/${slug}/settings/areas`);
    await expect(
      page.getByRole("link", { name: "folio", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Folio", exact: true }),
    ).toBeVisible();

    // Describe it, reload, and confirm it persisted.
    await page.getByRole("link", { name: "folio", exact: true }).click();
    await page.getByRole("textbox").first().fill("The folio workspace.");
    await page.getByRole("button", { name: "Save" }).click();
    await page.reload();
    await expect(page.getByRole("textbox").first()).toHaveValue(
      "The folio workspace.",
    );

    // Rename onto the existing name: the dialog must say it is a merge and
    // name the quest count, and the submit verb must change.
    await page.getByRole("button", { name: "Rename" }).click();
    await page.getByLabel("New name").fill("Folio");
    await expect(page.getByText(/1 quests will move into it/)).toBeVisible();
    await page.getByRole("button", { name: "Merge" }).click();

    // One area survives, holding both quests.
    await page.goto(`/${slug}/settings/areas`);
    await expect(
      page.getByRole("link", { name: "Folio", exact: true }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("link", { name: "folio", exact: true }),
    ).toHaveCount(0);

    // And the moved quest really carries the new name.
    await page.goto(`/${slug}/`);
    await expect(page.getByText(`Lower${t}`)).toBeVisible();
  });
});
