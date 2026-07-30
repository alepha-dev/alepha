import { expect, test } from "@playwright/test";
import {
  createCampaignViaWizard,
  newUserContext,
  registerAndVerify,
} from "./_helpers.ts";

test.describe("Invitation flow (in-app inbox)", () => {
  test("owner invites → invitee finds invite in profile inbox → accepts → joins as member", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const aEmail = `inviter-${Date.now()}@example.com`;
    await registerAndVerify(page, aEmail, "GoodPassw0rd");
    const campaignTitle = `Inv${Date.now()}`.slice(0, 20);
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    const b = await newUserContext(browser, baseURL!, "invitee");
    try {
      await page.goto(`/c/${campaignId}/settings/members`);
      await page.waitForLoadState("domcontentloaded");
      await page.getByRole("button", { name: /^invite$/i }).click();
      await expect(
        page.getByRole("heading", { name: /invite a user/i }),
      ).toBeVisible();
      await page.getByPlaceholder("user@example.com").fill(b.email);
      const createResp = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().endsWith("/api/invitations"),
        { timeout: 15_000 },
      );
      await page.getByRole("button", { name: /send invitation/i }).click();
      expect((await createResp).ok()).toBe(true);

      // The invitee opens their profile inbox — no link needed, the
      // invite is bound to their (verified) email.
      await b.page.goto("/auth/profile/invitations");
      await b.page.waitForLoadState("domcontentloaded");
      await expect(b.page.getByText(campaignTitle).first()).toBeVisible({
        timeout: 10_000,
      });

      const acceptResp = b.page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          /\/api\/invitations\/[^/]+\/accept$/.test(r.url()),
        { timeout: 15_000 },
      );
      await b.page.getByRole("button", { name: /^accept$/i }).click();
      expect((await acceptResp).ok()).toBe(true);

      await b.page.waitForURL(new RegExp(`/c/${campaignId}`), {
        timeout: 10_000,
      });

      await b.page.goto("/");
      await expect(b.page.getByText(campaignTitle).first()).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await b.ctx.close();
    }
  });

  test("invitee can decline from the profile inbox", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const aEmail = `inviter-${Date.now()}@example.com`;
    await registerAndVerify(page, aEmail, "GoodPassw0rd");
    const campaignTitle = `Dec${Date.now()}`.slice(0, 20);
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    const b = await newUserContext(browser, baseURL!, "decliner");
    try {
      await page.goto(`/c/${campaignId}/settings/members`);
      await page.waitForLoadState("domcontentloaded");
      await page.getByRole("button", { name: /^invite$/i }).click();
      await page.getByPlaceholder("user@example.com").fill(b.email);
      const createResp = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().endsWith("/api/invitations"),
        { timeout: 15_000 },
      );
      await page.getByRole("button", { name: /send invitation/i }).click();
      expect((await createResp).ok()).toBe(true);

      await b.page.goto("/auth/profile/invitations");
      await b.page.waitForLoadState("domcontentloaded");
      await expect(b.page.getByText(campaignTitle).first()).toBeVisible({
        timeout: 10_000,
      });

      const declineResp = b.page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          /\/api\/invitations\/[^/]+\/decline$/.test(r.url()),
        { timeout: 15_000 },
      );
      await b.page.getByRole("button", { name: /^decline$/i }).click();
      expect((await declineResp).ok()).toBe(true);

      // After decline, the inbox is empty and the campaign is not in the
      // user's home list.
      await expect(b.page.getByText(campaignTitle)).toHaveCount(0);
      await b.page.goto("/");
      await b.page.waitForLoadState("domcontentloaded");
      await expect(b.page.getByText(campaignTitle)).toHaveCount(0);
    } finally {
      await b.ctx.close();
    }
  });

  test("invitation is bound to the invited email — strangers see an empty inbox", async ({
    page,
    browser,
    baseURL,
  }) => {
    // Invitation goes to one address; a different account opens its
    // inbox and sees nothing.
    test.setTimeout(120_000);

    const aEmail = `inviter-${Date.now()}@example.com`;
    await registerAndVerify(page, aEmail, "GoodPassw0rd");
    const campaignTitle = `Bnd${Date.now()}`.slice(0, 20);
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    const invitedEmail = `target-${Date.now()}@example.com`;
    await page.goto(`/c/${campaignId}/settings/members`);
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("button", { name: /^invite$/i }).click();
    await page.getByPlaceholder("user@example.com").fill(invitedEmail);
    const createResp = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith("/api/invitations"),
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /send invitation/i }).click();
    expect((await createResp).ok()).toBe(true);

    // A different account checks the inbox.
    const b = await newUserContext(browser, baseURL!, "stranger");
    try {
      await b.page.goto("/auth/profile/invitations");
      await b.page.waitForLoadState("domcontentloaded");
      await expect(b.page.getByText(/no pending invitations/i)).toBeVisible({
        timeout: 10_000,
      });
      await expect(b.page.getByText(campaignTitle)).toHaveCount(0);
    } finally {
      await b.ctx.close();
    }
  });

  test("inviting the same email twice surfaces an error", async ({ page }) => {
    test.setTimeout(90_000);
    const aEmail = `inviter-${Date.now()}@example.com`;
    const target = `dup-${Date.now()}@example.com`;
    await registerAndVerify(page, aEmail, "GoodPassw0rd");
    const campaignId = await createCampaignViaWizard(
      page,
      `Dup${Date.now()}`.slice(0, 20),
    );

    await page.goto(`/c/${campaignId}/settings/members`);
    await page.waitForLoadState("domcontentloaded");

    await page.getByRole("button", { name: /^invite$/i }).click();
    await page.getByPlaceholder("user@example.com").fill(target);
    const firstResp = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith("/api/invitations"),
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /send invitation/i }).click();
    expect((await firstResp).ok()).toBe(true);

    await page.getByRole("button", { name: /^invite$/i }).click();
    await page.getByPlaceholder("user@example.com").fill(target);
    const secondResp = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith("/api/invitations"),
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /send invitation/i }).click();
    const second = await secondResp;
    expect(second.ok()).toBe(false);
    expect(second.status()).toBeGreaterThanOrEqual(400);
  });

  test("self-invite is blocked by the server", async ({ page }) => {
    test.setTimeout(90_000);
    const aEmail = `selfinv-${Date.now()}@example.com`;
    await registerAndVerify(page, aEmail, "GoodPassw0rd");
    const campaignId = await createCampaignViaWizard(
      page,
      `Slf${Date.now()}`.slice(0, 20),
    );

    await page.goto(`/c/${campaignId}/settings/members`);
    await page.waitForLoadState("domcontentloaded");

    await page.getByRole("button", { name: /^invite$/i }).click();
    await page.getByPlaceholder("user@example.com").fill(aEmail);
    const resp = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith("/api/invitations"),
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /send invitation/i }).click();
    const result = await resp;
    expect(result.ok()).toBe(false);
    expect(result.status()).toBeGreaterThanOrEqual(400);
  });
});
