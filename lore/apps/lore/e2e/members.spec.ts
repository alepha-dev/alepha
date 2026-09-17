import { expect, test } from "./_fixtures.ts";
import {
  apiPath,
  apiPost,
  createProjectViaWizard,
  newUserContext,
  registerAndVerify,
} from "./_helpers.ts";

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

  test("leaving removes access and releases accepted quests", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    await registerAndVerify(
      page,
      `leave-owner-${Date.now()}@example.com`,
      "GoodPassw0rd",
    );
    const title = `Leave${Date.now()}`.slice(0, 20);
    const { id: projectId, slug } = await createProjectViaWizard(page, title);
    const member = await newUserContext(browser, baseURL!, "leaver");

    try {
      await page.goto(`/${slug}/settings/members`);
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: /^invite$/i }).click();
      await page.getByPlaceholder("user@example.com").fill(member.email);
      await page.getByTestId("invite-rank").click();
      await page.getByRole("option", { name: /^contributor$/i }).click();
      await expect(
        page.getByRole("option", { name: /^contributor$/i }),
      ).toBeHidden();
      const invited = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/invitations"),
      );
      await page.getByRole("button", { name: /send invitation/i }).click();
      expect((await invited).ok()).toBe(true);

      await member.page.goto("/account/invitations");
      await expect(member.page.getByText(title).first()).toBeVisible({
        timeout: 15_000,
      });
      const accepted = member.page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          /\/api\/invitations\/[^/]+\/accept$/.test(response.url()),
      );
      await member.page.getByRole("button", { name: /^accept$/i }).click();
      expect((await accepted).ok()).toBe(true);
      await member.page.waitForURL(new RegExp(`/${slug}`));

      const quest = await apiPost<{ id: number }>(page, "createQuest", {
        projectId,
        title: `Leave quest ${Date.now()}`,
        description: "Released when its assignee leaves",
        area: "Main",
        priority: "medium",
        objectives: [],
        attachments: [],
      });
      const acceptQuestUrl = (
        await apiPath(member.page, "acceptQuest")
      ).replace(":id", String(quest.id));
      const acceptQuestStatus = await member.page.evaluate(async (url) => {
        const response = await fetch(url, { credentials: "include" });
        return response.status;
      }, acceptQuestUrl);
      expect(acceptQuestStatus).toBe(200);

      const projectUrl = (
        await apiPath(member.page, "getProjectBySlug")
      ).replace(":slug", slug);
      await member.page.goto(`/${slug}/settings`);
      await member.page.waitForLoadState("networkidle");
      await member.page
        .getByRole("button", { name: /^leave this project$/i })
        .click();
      const left = member.page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          /\/api\/organizations\/[^/]+\/leave$/.test(response.url()),
      );
      await member.page
        .getByRole("button", { name: /^leave project$/i })
        .click();
      expect((await left).ok()).toBe(true);
      await member.page.waitForURL(/\/$/, { timeout: 15_000 });

      const accessStatus = await member.page.evaluate(async (url) => {
        const response = await fetch(url, { credentials: "include" });
        return response.status;
      }, projectUrl);
      expect(accessStatus).toBeGreaterThanOrEqual(400);

      const questUrl = (await apiPath(page, "getQuestById")).replace(
        ":id",
        String(quest.id),
      );
      const released = await page.evaluate(async (url) => {
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<{
          acceptedBy?: string;
          metadata: { status: string };
        }>;
      }, questUrl);
      expect(released.acceptedBy).toBeUndefined();
      expect(released.metadata.status).toBe("todo");
    } finally {
      await member.ctx.close();
    }
  });
});
