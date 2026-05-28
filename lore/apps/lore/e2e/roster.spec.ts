import { expect, test } from "@playwright/test";
import { createCampaignViaWizard, registerAndVerify } from "./_helpers.ts";

test.describe("Roster page", () => {
  test("solo campaign hides Roster sidebar entry", async ({ page }) => {
    test.setTimeout(60_000);

    const email = `rs-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");
    const title = `RS${Date.now()}`.slice(0, 20);
    const campaignId = await createCampaignViaWizard(page, title);

    await page.goto(`/c/${campaignId}/`);
    await page.waitForLoadState("domcontentloaded");

    // Board entry is always there — used as a synchronization point so
    // we know the sidebar has rendered before asserting on Roster. (The
    // Character Sheet entry is no longer in the nav — it's a card in
    // the AppShell sidebarFooter slot now.) Scope to the sidebar nav
    // so the breadcrumb "Board" doesn't double-match.
    await expect(
      page
        .getByRole("navigation")
        .getByRole("link", { name: /^board$|^tableau$/i })
        .first(),
    ).toBeVisible({ timeout: 10_000 });

    // Roster entry must NOT be in the sidebar for a solo campaign.
    await expect(
      page.getByRole("link", { name: /^roster$|^équipée$/i }),
    ).toHaveCount(0);
  });
});
