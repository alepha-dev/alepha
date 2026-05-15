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
      // Toolbar's "Complete Quest" now opens a summary dialog; the dialog has
      // its own "Complete without summary" / "Complete with summary" buttons.
      // Pick the no-summary path for the golden flow.
      await page
        .getByRole("button", { name: /^complete quest$/i })
        .first()
        .click();
      await page
        .getByRole("button", { name: /complete without summary/i })
        .click();
      // Either stays on the quest view with a completed indicator or animates
      // back to the board — both leave us inside the campaign URL space.
      await page.waitForLoadState("networkidle");
      expect(page.url()).toContain(`/c/${campaignId}`);
    });
  });

  /**
   * Reminder configuration UI (Lore quest #42). Drives the Quest Settings
   * accordion block: enable a preset cadence, verify the active state +
   * "next email" status, then disable. The reminder send itself runs on a
   * 5-minute cron — that's covered by unit tests in `quest-reminder.spec.ts`;
   * this test focuses on the UI contract.
   */
  test("configure + disable a reminder from Quest Settings", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `reminder${t}@example.com`;
    const password = "ReminderTest123!";
    const campaignTitle = `RC${t}`.slice(0, 20);
    const questTitle = `Reminder${t}`;

    await registerAndVerify(page, email, password);
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    const { shortId } = await apiPost<{
      id: number;
      shortId: number;
    }>(page, "createQuest", {
      campaignId,
      title: questTitle,
      description: "Seeded quest for reminder e2e",
      zone: "Main",
      priority: "low",
      difficulty: 2,
      objectives: [],
      attachments: [],
    });

    await page.goto(`/c/${campaignId}/q/${shortId}`);
    await page.waitForLoadState("networkidle");

    await test.step("accept quest (reminder is gated on accepted state)", async () => {
      const accept = page.getByRole("button", {
        name: /sign and accept|accept.*quest/i,
      });
      await expect(accept).toBeVisible({ timeout: 10_000 });
      await accept.click();
      await expect(
        page.getByRole("button", { name: /complete.*quest/i }),
      ).toBeVisible({ timeout: 10_000 });
    });

    await test.step("expand the Settings block", async () => {
      // Settings is the only collapsible block that defaults to closed.
      // Target via data-testid — the sidebar also has a "Settings" link
      // and accessible-name matching is ambiguous.
      await page.getByTestId("quest-collapsible-settings").click();
      await expect(page.getByRole("radio", { name: /^daily$/i })).toBeVisible({
        timeout: 5_000,
      });
    });

    await test.step("enable Daily cadence", async () => {
      await page.getByRole("radio", { name: /^daily$/i }).click();
      // After the round-trip, the "Next email" status replaces the "no
      // reminder configured" line. We don't pin the exact phrasing — i18n
      // formats the relative time via dayjs — just confirm we left the
      // "no reminder" state.
      await expect(page.getByText(/no reminder configured/i)).toHaveCount(0, {
        timeout: 10_000,
      });
      await expect(page.getByText(/next email/i)).toBeVisible({
        timeout: 5_000,
      });
    });

    await test.step("disable via Off preset clears the status", async () => {
      await page.getByRole("radio", { name: /^off$/i }).click();
      await expect(page.getByText(/no reminder configured/i)).toBeVisible({
        timeout: 10_000,
      });
    });
  });
});
