import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  createCampaignViaWizard,
  newUserContext,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * Regression coverage for `/api/files/:id` IDOR.
 *
 * Before LoreFileAccessProvider, the framework's FileController.streamFile
 * was gated only by the wildcard `file:read` permission — any authenticated
 * user could download any file by UUID. Combined with the kanban public-read
 * endpoint, which exposes quest attachment UUIDs to anonymous viewers, this
 * meant a free account could enumerate UUIDs from public boards and pull
 * private attachments.
 *
 * This test:
 *   1. User A uploads a quest attachment to a private campaign.
 *   2. User B (separate account, not a member) attempts to download that
 *      file by its UUID and must get 403.
 *   3. User A successfully downloads their own attachment (sanity).
 */

const upload = async (
  page: Page,
  campaignId: number,
): Promise<{ fileId: string }> => {
  return await page.evaluate(
    async ({ campaignId }) => {
      const node = document.getElementById("__ssr");
      if (!node?.textContent) throw new Error("__ssr missing");
      const parsed = JSON.parse(node.textContent);
      const links = parsed["alepha.server.request.apiLinks"];
      const action = links?.actions?.uploadAttachment;
      if (!action) throw new Error("uploadAttachment not in apiLinks");
      const url = `${links.prefix ?? "/api"}${action.path.replace(/:campaignId\b/g, String(campaignId))}`;
      const form = new FormData();
      form.append(
        "file",
        new Blob(["secret-content"], { type: "text/plain" }),
        "secret.txt",
      );
      const r = await fetch(url, {
        method: action.method ?? "POST",
        credentials: "include",
        body: form,
      });
      if (!r.ok) {
        throw new Error(`upload failed: ${r.status} ${await r.text()}`);
      }
      return (await r.json()) as { fileId: string };
    },
    { campaignId },
  );
};

const fetchFile = async (page: Page, fileId: string): Promise<number> => {
  return await page.evaluate(async (id) => {
    const r = await fetch(`/api/files/${id}`, { credentials: "include" });
    return r.status;
  }, fileId);
};

const attachToQuest = async (
  page: Page,
  campaignId: number,
  fileId: string,
): Promise<{ id: number }> => {
  return await page.evaluate(
    async ({ campaignId, fileId }) => {
      const node = document.getElementById("__ssr");
      if (!node?.textContent) throw new Error("__ssr missing");
      const parsed = JSON.parse(node.textContent);
      const links = parsed["alepha.server.request.apiLinks"];
      const action = links?.actions?.createQuest;
      if (!action) throw new Error("createQuest not in apiLinks");
      const url = `${links.prefix ?? "/api"}${action.path}`;
      const r = await fetch(url, {
        method: action.method ?? "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          title: "Attach test",
          description: "<p>test</p>",
          zone: "Default",
          difficulty: 1,
          priority: "medium",
          attachments: [fileId],
        }),
      });
      if (!r.ok) {
        throw new Error(`createQuest failed: ${r.status} ${await r.text()}`);
      }
      return (await r.json()) as { id: number };
    },
    { campaignId, fileId },
  );
};

test.describe("File download authorization", () => {
  test("non-member cannot download another user's quest attachment", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const aEmail = `owner-${Date.now()}@example.com`;
    await registerAndVerify(page, aEmail, "GoodPassw0rd");
    const campaignId = await createCampaignViaWizard(
      page,
      `Sec${Date.now()}`.slice(0, 20),
    );

    // Upload an attachment and link it to a quest so LoreFileAccessProvider
    // can resolve the campaign by reverse-lookup.
    const { fileId } = await upload(page, campaignId);
    await attachToQuest(page, campaignId, fileId);

    // Sanity: uploader can still fetch their file.
    expect(await fetchFile(page, fileId)).toBe(200);

    const b = await newUserContext(browser, baseURL!, "attacker");
    try {
      await b.page.goto("/");
      await b.page.waitForLoadState("domcontentloaded");
      const status = await fetchFile(b.page, fileId);
      expect(status).toBe(403);
    } finally {
      await b.ctx.close();
    }
  });
});
