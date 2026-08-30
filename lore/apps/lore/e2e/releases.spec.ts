import { expect, type Page, test } from "@playwright/test";

import { apiPost, createProjectViaWizard, registerAndVerify } from "./_helpers";

/**
 * The release model end to end, replacing the recorder spec deleted in #1550.
 *
 * That one was a single test — start, record a quest, close, read the frozen
 * changelog — and every step of it stopped existing. What is pinned here is
 * what the new model claims and the old one could not do.
 *
 * ⚠️ Two traps this repo's e2e keeps hitting, both avoided below:
 * calls go through `/api/_batch`, so waiting on a single request URL waits
 * forever; and Base UI leaves `pointer-events: none` on the body after a
 * popover closes, so a click straight after a dialog dismiss silently misses.
 * Setup here is done over the API and only the assertions go through the UI.
 */

/**
 * POST to a name-derived action route.
 *
 * `apiPost` resolves an action through `apiLinks`, which has nowhere to put a
 * path parameter — the same reason `setProjectFeature` and `addKanbanColumn`
 * use a direct URL.
 */
const post = async <T>(page: Page, path: string, body: unknown): Promise<T> =>
  (await page.evaluate(
    async ({ path, body }) => {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return r.json();
    },
    { path, body },
  )) as T;

/**
 * Returns the HTTP status rather than throwing, for the refusals.
 */
const postStatus = async (
  page: Page,
  path: string,
  body: unknown,
): Promise<number> =>
  await page.evaluate(
    async ({ path, body }) => {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      return r.status;
    },
    { path, body },
  );

const get = async (page: Page, path: string): Promise<void> => {
  await page.evaluate(async (path) => {
    const r = await fetch(path, { credentials: "include" });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  }, path);
};

interface Release {
  id: number;
  number: number;
  tag?: string;
  progress: {
    completed: number;
    inProgress: number;
    shelved: number;
    total: number;
  };
}

const listReleases = async (page: Page, projectId: number) =>
  (await page.evaluate(async (projectId) => {
    const r = await fetch(`/api/getReleases/${projectId}`, {
      credentials: "include",
    });
    return r.json();
  }, projectId)) as Release[];

const createQuest = async (page: Page, projectId: number, title: string) =>
  await apiPost<{ id: number; shortId: number }>(page, "createQuest", {
    projectId,
    title,
    description: "",
    area: "lore/quests",
    priority: "high",
    objectives: [],
    attachments: [],
  });

const completeQuest = async (page: Page, id: number) => {
  await get(page, `/api/acceptQuest/${id}`);
  await post(page, `/api/completeQuest/${id}`, {});
};

test.describe("Releases", () => {
  test("many open at once, attach, freeze on publish", async ({ page }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `rel${t}@example.com`, "RelTest123!");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `RE${t}`.slice(0, 20),
    );

    // ── The assertion this whole epic exists for ──────────────────────────
    // Two releases, both open. The model this replaced refused to start a
    // second milestone while one was open, so `0.1.0` and `0.2.0` could not
    // coexist at all.
    const first = await post<Release>(page, `/api/createRelease/${projectId}`, {
      tag: "0.1.0",
    });
    await post<Release>(page, `/api/createRelease/${projectId}`, {
      tag: "0.2.0",
    });

    await page.goto(`/${slug}/releases`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("0.1.0").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("0.2.0").first()).toBeVisible();

    // ── An epic and a loose quest, and each quest counted once ────────────
    const epic = await post<{ id: number; number: number }>(
      page,
      `/api/createEpic/${projectId}`,
      { title: "The big feature" },
    );
    await post(page, `/api/updateEpic/${epic.id}`, { releaseId: first.id });

    const inEpicDone = await createQuest(page, projectId, `Done${t}`);
    const inEpicOpen = await createQuest(page, projectId, `Open${t}`);
    for (const quest of [inEpicDone, inEpicOpen]) {
      await post(page, `/api/attachQuest/${epic.id}`, { questId: quest.id });
    }
    await completeQuest(page, inEpicDone.id);

    const loose = await createQuest(page, projectId, `Loose${t}`);
    await post(page, `/api/updateQuestById/${loose.id}`, {
      releaseId: first.id,
    });

    // The same quest reachable BOTH ways: in the release's epic AND named
    // directly. It must still count once.
    const both = await createQuest(page, projectId, `Both${t}`);
    await post(page, `/api/attachQuest/${epic.id}`, { questId: both.id });
    await post(page, `/api/updateQuestById/${both.id}`, {
      releaseId: first.id,
    });

    const beforePublish = (await listReleases(page, projectId)).find(
      (r) => r.id === first.id,
    )!;
    expect(beforePublish.progress).toMatchObject({ completed: 1, total: 4 });

    // ── The detail page resolves by TAG ───────────────────────────────────
    await page.goto(`/${slug}/releases/0.1.0`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("The big feature").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(`Loose${t}`).first()).toBeVisible();

    // ── Publishing freezes the changelog AND the counts ───────────────────
    await post(page, `/api/publishRelease/${first.id}`, {});
    const atPublish = (await listReleases(page, projectId)).find(
      (r) => r.id === first.id,
    )!;
    expect(atPublish.progress).toMatchObject({ completed: 1, total: 4 });

    // Work landing AFTER publication must not rewrite what 0.1.0 shipped.
    await completeQuest(page, inEpicOpen.id);
    const afterMoreWork = (await listReleases(page, projectId)).find(
      (r) => r.id === first.id,
    )!;
    expect(afterMoreWork.progress).toMatchObject({ completed: 1, total: 4 });

    // ── A published release refuses an attach, from the API… ──────────────
    const orphan = await createQuest(page, projectId, `TooLate${t}`);
    expect(
      await postStatus(page, `/api/updateQuestById/${orphan.id}`, {
        releaseId: first.id,
      }),
    ).toBe(400);

    // …and offers nothing to click for it in the UI.
    await page.goto(`/${slug}/releases/0.1.0`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("The big feature").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("button", { name: /add epic/i })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: /add quest/i })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: /^publish$/i })).toHaveCount(
      0,
    );
  });

  test("orders by number, not by tag", async ({ page }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    await registerAndVerify(page, `relord${t}@example.com`, "RelTest123!");
    const { id: projectId } = await createProjectViaWizard(
      page,
      `RO${t}`.slice(0, 20),
    );

    // Sorted as TEXT, "0.10.0" comes before "0.9.0". Sorted by number — which
    // is what the list does — the creation order holds. This is the bug class
    // the epic names explicitly, and the only assertion that catches it.
    await post(page, `/api/createRelease/${projectId}`, { tag: "0.9.0" });
    await post(page, `/api/createRelease/${projectId}`, { tag: "0.10.0" });

    const releases = await listReleases(page, projectId);
    const byNumber = [...releases].sort((a, b) => a.number - b.number);
    expect(byNumber.map((r) => r.tag)).toEqual(["0.9.0", "0.10.0"]);
  });
});
