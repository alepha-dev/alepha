import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
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

  /**
   * The feed (quest #1236). Comments and the quest's own history events
   * interleave into ONE list — two stacked feeds read as bolted on, and the
   * interleaving is what makes a quest read as something that happened.
   */
  test("the Discussion shows events and comments in one feed", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `feed${t}@example.com`;
    const password = "FeedTest123!";
    const projectTitle = `FD${t}`.slice(0, 20);

    await registerAndVerify(page, email, password);
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const { id: questId, shortId } = await apiPost<{
      id: number;
      shortId: number;
    }>(page, "createQuest", {
      projectId,
      title: `Talked${t}`,
      description: "Seeded for the feed",
      area: "Main",
      priority: "medium",
      objectives: [],
      attachments: [],
    });

    await callWithId(page, "createQuestComment", questId, {
      body: "A comment that has to show up in the feed.",
    });

    await page.goto(`/${projectSlug}/quests/${shortId}`);
    await page.waitForLoadState("networkidle");

    await test.step("both kinds of row are there, and the RPG titles are not", async () => {
      const feed = page
        .getByRole("list")
        .filter({ hasText: "created the quest" });
      await expect(feed).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByText("A comment that has to show up in the feed."),
      ).toBeVisible();

      // The timeline this replaces hardcoded these, untranslated, and said
      // "by You" for every actor.
      await expect(page.getByText(/A New Dawn|Courageous Choice/)).toHaveCount(
        0,
      );
      await expect(page.getByText(/by You/)).toHaveCount(0);
    });

    // The Everything / Comments-only filter that used to be asserted here is
    // gone: it sat permanently in the section header, defaulted to
    // everything, and was a standing control for a view almost nobody
    // switched to. One feed, no filter.
  });

  /**
   * The composer (quest #1237). Writing a comment from the page is the half
   * that closes the loop the MCP tools open.
   */
  test("the composer posts a comment and resolves a #quest reference", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `composer${t}@example.com`;
    const password = "ComposeTest123!";
    const projectTitle = `CP${t}`.slice(0, 20);

    await registerAndVerify(page, email, password);
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const other = await apiPost<{ id: number; shortId: number }>(
      page,
      "createQuest",
      {
        projectId,
        title: `Referenced${t}`,
        description: "The quest a comment points at",
        area: "Main",
        priority: "low",
        objectives: [],
        attachments: [],
      },
    );
    const { shortId } = await apiPost<{ id: number; shortId: number }>(
      page,
      "createQuest",
      {
        projectId,
        title: `Composed${t}`,
        description: "Seeded for the composer",
        area: "Main",
        priority: "medium",
        objectives: [],
        attachments: [],
      },
    );

    await page.goto(`/${projectSlug}/quests/${shortId}`);
    await page.waitForLoadState("networkidle");

    await test.step("type and send", async () => {
      const box = page.getByRole("textbox", { name: /leave a comment/i });
      await expect(box).toBeVisible({ timeout: 10_000 });
      await box.fill(`Blocked by #${other.shortId}, see there.`);
      await page.getByRole("button", { name: /^comment$/i }).click();

      // The feed takes the posted comment without a reload. Assert on the
      // tail, not the `#N`: once the reference resolves it is replaced by a
      // link carrying the target quest's title, so the `#` is gone.
      await expect(page.getByText(/see there/)).toBeVisible({
        timeout: 10_000,
      });
      // The box empties, so a second comment does not start from the first.
      await expect(box).toHaveValue("");
    });

    await test.step("the bare #N became a real link to that quest", async () => {
      // Expanded into `[[quest:#N]]` on the way into the shared resolver —
      // the same one that renders a description's wiki links.
      const link = page.getByRole("link", {
        name: new RegExp(`Referenced${t}`),
      });
      await expect(link).toHaveAttribute(
        "href",
        `/${projectSlug}/quests/${other.shortId}`,
        { timeout: 10_000 },
      );
    });

    await test.step("it survives a reload, so it was really stored", async () => {
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(/see there/)).toBeVisible({
        timeout: 10_000,
      });
    });
  });
});
