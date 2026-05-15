import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  createCampaignViaWizard,
  newUserContext,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * Regression coverage for the public-campaign authorization bug:
 * `AppSecurityProvider.checkOwnership` used to short-circuit on
 * `campaign.public === true`, so every mutating endpoint was open to
 * any authenticated user. Public campaigns must stay read-visible to
 * outsiders but write-locked to non-members.
 */

const patchApiLinks = async (page: Page, targetId: number) => {
  await page.evaluate((id) => {
    const node = document.getElementById("__ssr");
    if (!node?.textContent) return;
    const parsed = JSON.parse(node.textContent);
    const links = parsed["alepha.server.request.apiLinks"];
    if (!links?.actions) return;
    for (const key of Object.keys(links.actions)) {
      const action = links.actions[key];
      action.path = action.path
        .replace(/:id\b/g, String(id))
        .replace(/:campaignId\b/g, String(id));
    }
    node.textContent = JSON.stringify(parsed);
  }, targetId);
};

const callAction = async (
  page: Page,
  action: string,
  body?: unknown,
): Promise<{ status: number; text: string }> => {
  return await page.evaluate(
    async ({ action, body }) => {
      const node = document.getElementById("__ssr");
      if (!node?.textContent) throw new Error("__ssr missing");
      const parsed = JSON.parse(node.textContent) as {
        "alepha.server.request.apiLinks"?: {
          prefix?: string;
          actions?: Record<string, { path: string; method?: string }>;
        };
      };
      const links = parsed["alepha.server.request.apiLinks"];
      const entry = links?.actions?.[action];
      if (!entry) throw new Error(`Unknown action: ${action}`);
      const method = entry.method ?? (body !== undefined ? "POST" : "GET");
      const url = `${links?.prefix ?? "/api"}${entry.path}`;
      const r = await fetch(url, {
        method,
        credentials: "include",
        ...(body !== undefined
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
      return { status: r.status, text: await r.text() };
    },
    { action, body },
  );
};

test.describe("Public campaign authorization", () => {
  test("non-member cannot mutate a public campaign", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    // ── User A: owner, makes their campaign public ───────────────────
    const ownerEmail = `owner-${Date.now()}@example.com`;
    await registerAndVerify(page, ownerEmail, "GoodPassw0rd");
    const campaignTitle = `Sec${Date.now()}`.slice(0, 20);
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    // Flip the campaign to public via the same endpoint a real user would.
    await page.waitForLoadState("domcontentloaded");
    await patchApiLinks(page, campaignId);
    const flipResp = await callAction(page, "updateCampaignById", {
      public: true,
    });
    // Owner's own write must succeed.
    expect(flipResp.status, flipResp.text).toBeLessThan(400);

    // ── User B: separate account, never invited ──────────────────────
    const b = await newUserContext(browser, baseURL!, "attacker");
    try {
      // Land on a page so `__ssr` is hydrated with apiLinks.
      await b.page.goto("/");
      await b.page.waitForLoadState("domcontentloaded");

      // The SSR-baked apiLinks paths use route placeholders (`:id`,
      // `:campaignId`) until materialized by the active route — since B
      // is on "/", patch them to point at the owner's campaign.
      await patchApiLinks(b.page, campaignId);

      // Every one of these endpoints used to succeed for a logged-in
      // non-member when the campaign was public. They must all 403 now.
      const updateResp = await callAction(b.page, "updateCampaignById", {
        title: "pwned",
      });
      expect(updateResp.status).toBe(403);

      const renameZoneResp = await callAction(b.page, "renameZone", {
        oldZoneName: "Default",
        newZoneName: "pwned",
      });
      expect(renameZoneResp.status).toBe(403);

      const addColResp = await callAction(b.page, "addKanbanColumn", {
        name: "pwned-col",
      });
      expect(addColResp.status).toBe(403);

      const deleteResp = await callAction(b.page, "deleteCampaignById");
      expect(deleteResp.status).toBe(403);

      // Reads on a public campaign should still work for any logged-in
      // user — that's the whole point of the `public` flag.
      const readResp = await callAction(b.page, "getCampaignById");
      expect(readResp.status).toBeLessThan(400);
    } finally {
      await b.ctx.close();
    }
  });
});
