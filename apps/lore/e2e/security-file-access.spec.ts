import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import {
  createProjectViaWizard,
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
 *   1. User A uploads a quest attachment to a private project.
 *   2. User B (separate account, not a member) attempts to download that
 *      file by its UUID and must get 403.
 *   3. User A successfully downloads their own attachment (sanity).
 */

const upload = async (
  page: Page,
  projectId: number,
): Promise<{ fileId: string }> => {
  return await page.evaluate(
    async ({ projectId }) => {
      const node = document.getElementById("__ssr");
      if (!node?.textContent) throw new Error("__ssr missing");
      const parsed = JSON.parse(node.textContent);
      const links = parsed["alepha.server.request.apiLinks"];
      const action = links?.actions?.uploadAttachment;
      if (!action) throw new Error("uploadAttachment not in apiLinks");
      const url = `${links.prefix ?? "/api"}${action.path.replace(/:projectId\b/g, String(projectId))}`;
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
    { projectId },
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
  projectId: number,
  fileId: string,
): Promise<{ id: number }> => {
  return await page.evaluate(
    async ({ projectId, fileId }) => {
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
          projectId,
          title: "Attach test",
          description: "<p>test</p>",
          area: "Default",
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
    { projectId, fileId },
  );
};

/** Upload a real 1×1 PNG via `updateMyAvatar` → avatars bucket. Returns the
 *  user's new `picture` file id. Lore's own `UserController.updateAvatar` was
 *  deleted when the account area moved onto the framework's
 *  `MyProfileController`; this is the same upload through that endpoint. */
const uploadAvatar = async (page: Page): Promise<string> => {
  return await page.evaluate(async () => {
    const node = document.getElementById("__ssr");
    if (!node?.textContent) throw new Error("__ssr missing");
    const parsed = JSON.parse(node.textContent);
    const links = parsed["alepha.server.request.apiLinks"];
    const action = links?.actions?.updateMyAvatar;
    if (!action) throw new Error("updateMyAvatar not in apiLinks");
    const url = `${links.prefix ?? "/api"}${action.path}`;
    // Minimal valid 1×1 transparent PNG (avatars bucket is image-only).
    const b64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "image/png" }), "a.png");
    const r = await fetch(url, {
      method: action.method ?? "POST",
      credentials: "include",
      body: form,
    });
    if (!r.ok) throw new Error(`avatar upload failed: ${r.status}`);
    const u = (await r.json()) as { picture: string };
    return u.picture;
  });
};

/** Fetch the anonymous public route WITHOUT credentials. */
const fetchPublic = async (page: Page, fileId: string): Promise<number> => {
  return await page.evaluate(async (id) => {
    const r = await fetch(`/api/public/files/${id}`);
    return r.status;
  }, fileId);
};

test.describe("Public file access", () => {
  test("avatars are served anonymously; private attachments are not", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const email = `pub-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      `Pub${Date.now()}`.slice(0, 20),
    );

    const avatarId = await uploadAvatar(page); // avatars bucket → public
    const { fileId: attachmentId } = await upload(page, projectId); // private
    await attachToQuest(page, projectId, attachmentId);

    // Anonymous browser context — no auth cookie at all.
    const anon = await browser.newContext();
    try {
      const anonPage = await anon.newPage();
      await anonPage.goto(baseURL!);
      await anonPage.waitForLoadState("domcontentloaded");

      // Avatar opt-ed into `assertPublic` → served anonymously.
      expect(await fetchPublic(anonPage, avatarId)).toBe(200);
      // Private quest attachment must NOT leak through the public route.
      expect(await fetchPublic(anonPage, attachmentId)).toBe(404);
    } finally {
      await anon.close();
    }
  });
});

test.describe("File download authorization", () => {
  test("non-member cannot download another user's quest attachment", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const aEmail = `owner-${Date.now()}@example.com`;
    await registerAndVerify(page, aEmail, "GoodPassw0rd");
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      `Sec${Date.now()}`.slice(0, 20),
    );

    // Upload an attachment and link it to a quest so LoreFileAccessProvider
    // can resolve the project by reverse-lookup.
    const { fileId } = await upload(page, projectId);
    await attachToQuest(page, projectId, fileId);

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
