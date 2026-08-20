import { expect, type Page, test } from "@playwright/test";
import {
  apiPost,
  createProjectViaWizard,
  newUserContext,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * The Discussion's transport (quest #1235).
 *
 * API-level on purpose: this is the half that exists before the feed and the
 * composer do (#1236 / #1237), and it is the half `test/quest-comments.spec.ts`
 * cannot reach — real HTTP, real session cookies, real response
 * serialization. The composer quest extends this file with the UI half.
 */

/**
 * `apiPost` in `_helpers` only carries a body. Comment endpoints take the id
 * in the path (`/api/<action>/<id>`), the same shape `setProjectFeature`
 * builds by hand.
 */
const callWithId = async <T>(
  page: Page,
  action: string,
  id: number,
  body?: unknown,
): Promise<{ status: number; data: T }> => {
  return await page.evaluate(
    async ({ action, id, body }) => {
      // Reads are GET, writes are POST — an `$action` whose schema carries no
      // `body` is routed as a GET, so posting to it 404s on the method.
      const method = body === undefined ? "GET" : "POST";
      const r = await fetch(`/api/${action}/${id}`, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: method === "GET" ? undefined : JSON.stringify(body),
      });
      return {
        status: r.status,
        data: r.ok ? await r.json() : await r.text(),
      };
    },
    { action, id, body },
  );
};

test.describe("Quest comments", () => {
  test("post, list, edit and delete a comment; a stranger is refused", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    const email = `comment${t}@example.com`;
    const password = "CommentTest123!";
    const projectTitle = `CM${t}`.slice(0, 20);

    await registerAndVerify(page, email, password);
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const { id: questId } = await apiPost<{ id: number; shortId: number }>(
      page,
      "createQuest",
      {
        projectId,
        title: `Discussed${t}`,
        description: "Seeded for the discussion",
        area: "Main",
        priority: "medium",
        objectives: [],
        attachments: [],
      },
    );

    let commentId = 0;

    await test.step("post one and read it back", async () => {
      const created = await callWithId<{ id: number; body: string }>(
        page,
        "createQuestComment",
        questId,
        { body: "Do X differently next time." },
      );
      expect(created.status).toBe(200);
      commentId = created.data.id;

      const listed = await callWithId<Array<{ id: number; body: string }>>(
        page,
        "listQuestComments",
        questId,
      );
      expect(listed.status).toBe(200);
      expect(listed.data.map((c) => c.body)).toEqual([
        "Do X differently next time.",
      ]);
    });

    await test.step("edit it, and the edit is stamped", async () => {
      const updated = await callWithId<{ body: string; editedAt?: string }>(
        page,
        "updateQuestComment",
        commentId,
        { body: "Do X differently, and here is why." },
      );
      expect(updated.status).toBe(200);
      expect(updated.data.body).toContain("here is why");
      // `editedAt` is what lets the feed say "edited" without lying:
      // `updatedAt` is stamped by any write.
      expect(updated.data.editedAt).toBeTruthy();
    });

    await test.step("a non-member cannot read or write the discussion", async () => {
      const stranger = await newUserContext(browser, baseURL!, "stranger");
      try {
        // Any page inside the app, just to get an origin for `fetch`.
        await stranger.page.goto("/");
        await stranger.page.waitForLoadState("networkidle");

        const read = await callWithId(
          stranger.page,
          "listQuestComments",
          questId,
        );
        expect(read.status).toBeGreaterThanOrEqual(400);

        const write = await callWithId(
          stranger.page,
          "createQuestComment",
          questId,
          { body: "Hello?" },
        );
        expect(write.status).toBeGreaterThanOrEqual(400);
      } finally {
        await stranger.ctx.close();
      }
    });

    await test.step("delete it and the discussion is empty again", async () => {
      // No body, so it routes as a GET — the same shape `deleteQuest` has:
      // `$action` derives the method from the presence of a body schema.
      const deleted = await callWithId(page, "deleteQuestComment", commentId);
      expect(deleted.status).toBe(200);

      const listed = await callWithId<unknown[]>(
        page,
        "listQuestComments",
        questId,
      );
      expect(listed.data).toHaveLength(0);
    });

    // The project is still reachable — nothing here touched the quest.
    await page.goto(`/${projectSlug}/`);
    await expect(page.getByTestId("quests-table")).toBeVisible({
      timeout: 10_000,
    });
  });
});
