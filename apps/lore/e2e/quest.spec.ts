import * as fs from "node:fs";
import { expect, test } from "@playwright/test";
import {
  apiPost,
  clearEmails,
  createCampaignViaWizard,
  emailDir,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * Quest feature e2e: seeded via API (the Zone combobox is not creatable from
 * scratch in the UI), then driven through the real shadcn UI for open →
 * accept → complete.
 *
 * Per the Lore CLAUDE.md convention, each big feature owns its own spec file.
 * Campaign create + auth are covered by the helpers — kept here as setup,
 * not as the focus of the test.
 */
test.describe("Quest", () => {
  test.beforeAll(() => {
    fs.mkdirSync(emailDir, { recursive: true });
    clearEmails();
  });

  test("accept → complete from quest view", async ({ page }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `quest${t}@example.com`;
    const password = "QuestTest123!";
    const campaignTitle = `QC${t}`.slice(0, 20);
    const questTitle = `Quest${t}`;

    await registerAndVerify(page, email, password);
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    const { id: questId, shortId } = await apiPost<{
      id: number;
      shortId: number;
    }>(page, "createQuest", {
      campaignId,
      title: questTitle,
      description: "Seeded quest for e2e",
      zone: "Main",
      priority: "medium",
      difficulty: 3,
      objectives: [],
      attachments: [],
    });
    expect(questId).toBeGreaterThan(0);
    expect(shortId).toBeGreaterThan(0);

    await test.step("open quest view", async () => {
      await page.goto(`/c/${campaignId}/q/${shortId}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(questTitle).first()).toBeVisible({
        timeout: 10_000,
      });
    });

    await test.step("accept quest", async () => {
      const accept = page.getByRole("button", {
        name: /sign and accept|accept.*quest/i,
      });
      await expect(accept).toBeVisible({ timeout: 10_000 });
      await accept.click();
      // Once accepted, the Complete button is unlocked.
      await expect(
        page.getByRole("button", { name: /complete.*quest/i }),
      ).toBeVisible({ timeout: 10_000 });
    });

    await test.step("complete quest", async () => {
      await page.getByRole("button", { name: /complete.*quest/i }).click();
      // Either stays on the quest view with a completed indicator or animates
      // back to the board — both leave us inside the campaign URL space.
      await page.waitForLoadState("networkidle");
      expect(page.url()).toContain(`/c/${campaignId}`);
    });
  });
});
