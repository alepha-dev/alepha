import { expect, test } from "@playwright/test";
import { createCampaignViaWizard, registerAndVerify } from "./_helpers.ts";

test.describe("CharacterIdentity hover-card", () => {
  test("hovering the avatar in Settings → Characters reveals identity", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const email = `ci-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");
    const title = `CI${Date.now()}`.slice(0, 20);
    const campaignId = await createCampaignViaWizard(page, title);

    await page.goto(`/c/${campaignId}/settings/characters`);
    await page.waitForLoadState("domcontentloaded");

    // The owner's own character is rendered as a CharacterIdentity card.
    const trigger = page.getByTestId("character-identity").first();
    await expect(trigger).toBeVisible();

    await trigger.hover();
    // Hover-card content is portalled into the body; assert it appears
    // and surfaces the Owner badge (this campaign's creator is the owner).
    const content = page.locator('[data-slot="hover-card-content"]');
    await expect(content).toBeVisible({ timeout: 5_000 });
    await expect(content.getByText(/owner/i)).toBeVisible();
    await expect(content.getByText(/Lv\.\s*1/i)).toBeVisible();
  });
});
