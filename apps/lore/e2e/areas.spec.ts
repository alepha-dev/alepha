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

    // A disposable area, used only for the plain-rename regression below:
    // a rename with no collision. The surviving id there is the SAME id
    // as the one already in the URL, so a push that omits `force: true`
    // would target the URL the user is already on and
    // `ReactPageProvider.createLayers` would silently reuse the previous
    // layer's cached props — no error, no toast, just a page that never
    // updates. The merge case below can't catch that: it always
    // navigates to a DIFFERENT id, which is a real navigation either way.
    const soloArea = `solo${t}`;
    await apiPost(page, "createQuest", {
      projectId,
      title: `Solo${t}`,
      description: "Seeded for the plain-rename regression",
      area: soloArea,
      priority: "medium",
      objectives: [],
      attachments: [],
    });

    await test.step("a plain rename (no collision) updates the page in place, with no reload or navigation", async () => {
      await page.goto(`/${slug}/settings/areas`);
      await page.getByRole("link", { name: soloArea, exact: true }).click();
      await expect(page.getByRole("heading", { name: soloArea })).toBeVisible();

      const renamedTo = `Renamed${t}`;
      await page.getByRole("button", { name: "Rename" }).click();
      await page.getByLabel("New name").fill(renamedTo);

      // No collision: the submit stays "Rename", not "Merge". Scoped to
      // the dialog because the header behind it also has a button named
      // "Rename" (the one that opened this dialog in the first place).
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("button", { name: "Merge" })).toHaveCount(
        0,
      );
      await dialog.getByRole("button", { name: "Rename" }).click();

      // The whole point of this test: no `goto`, no reload — and yet the
      // heading must already read the new name. This is what a missing
      // `force: true` on the post-rename push would silently fail.
      await expect(
        page.getByRole("heading", { name: renamedTo }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: soloArea })).toHaveCount(
        0,
      );
    });

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
    // Armed BEFORE the click, like the folio-workspace autosave wait: a
    // lone `updateArea` call is a single entry in `BatchCollector`'s 10ms
    // window, so it skips `/api/_batch` and goes out as a direct
    // `/api/updateArea/:id` call (see `BatchCollector.flush`) — reloading
    // before it resolves races the save and the reload wins, so the
    // assertion below would measure the reload instead of the persist.
    const saved = page.waitForResponse(
      (r) => /\/api\/updateArea\//.test(r.url()) && r.status() === 200,
    );
    await page.getByRole("button", { name: "Save" }).click();
    await saved;
    await page.reload();
    await expect(page.getByRole("textbox").first()).toHaveValue(
      "The folio workspace.",
    );

    // Rename onto the existing name: the dialog must say it is a merge and
    // name the quest count, and the submit verb must change.
    await page.getByRole("button", { name: "Rename" }).click();
    await page.getByLabel("New name").fill("Folio");
    await expect(page.getByText(/1 quest will move into it/)).toBeVisible();
    // Same hazard as the description Save above: `renameArea` is a lone
    // call, so it skips `/api/_batch` and goes out directly. The
    // `page.goto` right after would otherwise race it and cancel the
    // merge mid-flight, leaving "folio" un-merged for the assertions below.
    const merged = page.waitForResponse(
      (r) => /\/api\/renameArea\//.test(r.url()) && r.status() === 200,
    );
    await page.getByRole("button", { name: "Merge" }).click();
    await merged;

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
