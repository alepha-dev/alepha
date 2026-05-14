import * as fs from "node:fs";
import { expect, test } from "@playwright/test";
import {
  clearEmails,
  createCampaignViaWizard,
  emailDir,
  newUserContext,
  registerAndVerify,
} from "./_helpers.ts";

test.describe("Invitation flow", () => {
  test.beforeAll(() => {
    fs.mkdirSync(emailDir, { recursive: true });
    clearEmails();
  });

  test("owner invites → adventurer accepts → joins campaign", async ({
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
      await page.goto(`/c/${campaignId}/settings/adventurers`);
      await page.waitForLoadState("domcontentloaded");
      await page.getByRole("button", { name: /^invite$/i }).click();
      await expect(
        page.getByRole("heading", { name: /invite adventurer/i }),
      ).toBeVisible();
      await page.getByPlaceholder("adventurer@example.com").fill(b.email);
      const createResp = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().endsWith("/api/invitations"),
        { timeout: 15_000 },
      );
      await page.getByRole("button", { name: /send invitation/i }).click();
      expect((await createResp).ok()).toBe(true);
      // The component doesn't auto-refresh `pendingInvitations` after submit,
      // so we don't assert on the local UI state here — the response status
      // is the source of truth. The pending list appears on next page load.

      await b.page.goto("/auth/profile/invitations");
      await b.page.waitForLoadState("domcontentloaded");
      await expect(b.page.getByText(campaignTitle)).toBeVisible({
        timeout: 5_000,
      });
      const acceptResp = b.page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          /\/api\/invitations\/[^/]+\/accept$/.test(r.url()),
        { timeout: 15_000 },
      );
      await b.page.getByRole("button", { name: /^accept$/i }).click();
      expect((await acceptResp).ok()).toBe(true);

      await b.page.goto("/");
      await expect(b.page.getByText(campaignTitle)).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await b.ctx.close();
    }
  });

  test("adventurer can decline a pending invitation", async ({
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
      await page.goto(`/c/${campaignId}/settings/adventurers`);
      await page.waitForLoadState("domcontentloaded");
      await page.getByRole("button", { name: /^invite$/i }).click();
      await page.getByPlaceholder("adventurer@example.com").fill(b.email);
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
      await expect(b.page.getByText(campaignTitle)).toBeVisible({
        timeout: 5_000,
      });
      const declineResp = b.page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          /\/api\/invitations\/[^/]+\/decline$/.test(r.url()),
        { timeout: 15_000 },
      );
      await b.page.getByRole("button", { name: /^decline$/i }).click();
      expect((await declineResp).ok()).toBe(true);

      await b.page.goto("/");
      await b.page.waitForLoadState("domcontentloaded");
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

    await page.goto(`/c/${campaignId}/settings/adventurers`);
    await page.waitForLoadState("domcontentloaded");

    // First invitation — succeeds.
    await page.getByRole("button", { name: /^invite$/i }).click();
    await page.getByPlaceholder("adventurer@example.com").fill(target);
    const firstResp = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith("/api/invitations"),
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /send invitation/i }).click();
    expect((await firstResp).ok()).toBe(true);

    // Second invitation, same email — server rejects.
    await page.getByRole("button", { name: /^invite$/i }).click();
    await page.getByPlaceholder("adventurer@example.com").fill(target);
    const secondResp = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith("/api/invitations"),
      { timeout: 15_000 },
    );
    await page.getByRole("button", { name: /send invitation/i }).click();
    const second = await secondResp;
    expect(second.ok()).toBe(false);
    expect(second.status()).toBeGreaterThanOrEqual(400);
    // The server returns a 4xx with "already exists" — that's the contract
    // we care about. We don't assert on the local pending-list rendering
    // here because the dialog's filled email input would also match a
    // getByText() count check and produce a misleading number.
  });

  test("self-invite is blocked by the server", async ({ page }) => {
    test.setTimeout(90_000);
    const aEmail = `selfinv-${Date.now()}@example.com`;
    await registerAndVerify(page, aEmail, "GoodPassw0rd");
    const campaignId = await createCampaignViaWizard(
      page,
      `Slf${Date.now()}`.slice(0, 20),
    );

    await page.goto(`/c/${campaignId}/settings/adventurers`);
    await page.waitForLoadState("domcontentloaded");

    await page.getByRole("button", { name: /^invite$/i }).click();
    await page.getByPlaceholder("adventurer@example.com").fill(aEmail);
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
