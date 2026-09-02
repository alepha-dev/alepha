import { expect, test } from "@playwright/test";

import { createProjectViaWizard, registerAndVerify } from "./_helpers.ts";

test.describe("Members settings page", () => {
  test("lists the owner with the Owner badge on the row", async ({ page }) => {
    test.setTimeout(90_000);

    const email = `mb-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");
    const title = `MB${Date.now()}`.slice(0, 20);
    const { slug: projectSlug } = await createProjectViaWizard(page, title);

    await page.goto(`/${projectSlug}/settings/members`);
    await page.waitForLoadState("domcontentloaded");

    // The owner's own membership is rendered as a MemberIdentity card.
    const trigger = page.getByTestId("member-identity").first();
    await expect(trigger).toBeVisible({ timeout: 10_000 });

    // The row shows the account email — identity comes from the user
    // account, there is no per-project alias anymore.
    await expect(page.getByText(email).first()).toBeVisible();

    // The Owner badge is on the row itself: the hover card that used to
    // carry it repeated the row it decorated and is gone (feedback #2067).
    await expect(trigger.getByText(/owner/i)).toBeVisible();
    await trigger.hover();
    await expect(page.locator('[data-slot="hover-card-content"]')).toHaveCount(
      0,
    );
  });

  test("old character and roster URLs are gone", async ({ page }) => {
    test.setTimeout(90_000);

    const email = `mb404-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");
    const title = `MB404${Date.now()}`.slice(0, 20);
    const { slug: projectSlug } = await createProjectViaWizard(page, title);

    for (const path of [
      `/${projectSlug}/character`,
      `/${projectSlug}/roster`,
    ]) {
      await page.goto(path);
      await page.waitForLoadState("domcontentloaded");
      await expect(
        page.getByText(/not found|introuvable|404/i).first(),
      ).toBeVisible({ timeout: 10_000 });
    }
  });
});
