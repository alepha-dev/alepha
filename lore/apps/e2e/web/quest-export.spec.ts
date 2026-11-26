import * as fs from "node:fs";
import * as path from "node:path";

import { expect, test } from "./_fixtures.ts";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
  setCapability,
} from "./_helpers.ts";

/**
 * Covers the Data settings page export flow end-to-end (UI → server →
 * downloaded CSV).
 *
 * ⚠️ It was `quest-import-export.spec.ts` and held exactly this one test:
 * the import path was never driven from the browser, because `setInputFiles`
 * triggers a direct multipart POST through the Alepha client and the e2e
 * session-token wiring for that path is brittle. Quest import is gone
 * entirely since epic #E48, along with the card this page no longer renders,
 * so the file is named for what it covers.
 */
test.describe("Quest CSV export", () => {
  test("exports a project's quests as CSV via Settings → Plan → Quests", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const ts = Date.now();
    const email = `data${ts}@example.com`;
    const password = "GoodPassw0rd";

    await registerAndVerify(page, email, password);
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      `Src${ts}`,
    );

    // Seed one quest via the API — UI quest-create is exercised by quest.spec.ts.
    await apiPost<{ id: number; shortId: number }>(page, "createQuest", {
      projectId,
      title: "Roundtrip quest",
      description: "Seeded for the export e2e.",
      area: "Main",
      priority: "medium",
      objectives: [],
      attachments: [],
    });

    // The Data section lives in Settings → Plan → Quests (#Q4443), not on
    // General, so it is gone with Plan.
    await page.goto(`/${projectSlug}/settings/work`);
    await page.waitForLoadState("domcontentloaded");

    // Export button — labelled by `project.settings.data.export.button`
    // ("Export Quests"). Use a generous timeout because the settings page
    // hydrates after `domcontentloaded`.
    const exportBtn = page.getByRole("button", { name: /export quests/i });
    await expect(exportBtn).toBeVisible({ timeout: 10_000 });

    // Trigger export and capture the download.
    const downloadPromise = page.waitForEvent("download");
    await exportBtn.click();
    const download = await downloadPromise;
    const csvPath = path.join(testInfo.outputDir, download.suggestedFilename());
    await download.saveAs(csvPath);

    const csvText = fs.readFileSync(csvPath, "utf-8");
    // Header line matches the Alepha Lore format.
    expect(csvText.split("\n")[0]).toContain("shortId");
    expect(csvText.split("\n")[0]).toContain("priority");
    expect(csvText).toContain("Roundtrip quest");

    // With Plan off the export is offered nowhere (#Q4443): not on General,
    // where it used to be, nor on the Plan page reached by its address.
    await page.goto(`/${projectSlug}/settings/work`);
    await expect(exportBtn).toBeVisible({ timeout: 10_000 });
    await setCapability(page, projectId, "plan", { enabled: false });
    await page.goto(`/${projectSlug}/settings/`);
    // General is drawn, so the absence below is a real one.
    await expect(
      page.getByRole("button", { name: /delete this project/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(exportBtn).toHaveCount(0);
    await page.goto(`/${projectSlug}/settings/work`);
    await page.waitForLoadState("networkidle");
    await expect(exportBtn).toHaveCount(0);
  });
});
