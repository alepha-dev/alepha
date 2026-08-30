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

  /**
   * The page is an `AlephaTable` now, shaped like Epics. These are the two
   * affordances the rebuild added, and the ones a card list could not have.
   *
   * ⚠️ The sort assertion is the same trap as the data-level test above, one
   * layer up: the header says "Release" and shows tags, and it must still
   * order by `number`. As text `0.28.0` sorts before `0.9.0`, so a string
   * comparator fails this rather than passing by luck.
   */
  /**
   * Creating a release, which is a dialog now rather than a bordered row
   * swapped into the top of the page.
   *
   * The second half is the half worth having. A duplicate tag is the failure
   * this form actually meets, and it has to be recoverable by editing the
   * value that is already typed — so the message belongs under the field,
   * with the dialog still open holding it, not in a toast that outlives the
   * dialog and takes the typed tag with it.
   */
  test("the create dialog refreshes the list and keeps its own errors", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `relnew${t}@example.com`, "RelTest123!");
    const { slug } = await createProjectViaWizard(page, `RN${t}`.slice(0, 20));

    await page.goto(`/${slug}/releases`);

    const open = page.getByRole("button", { name: "New Release" }).first();
    const tagField = page.getByLabel("Tag");

    await test.step("creating one puts it in the list", async () => {
      await expect(open).toBeVisible({ timeout: 15_000 });
      await open.click();
      await tagField.fill("0.1.0");
      await page.getByRole("button", { name: "Create" }).click();

      // The table fetches its own rows, so this is the assertion that the
      // create actually signalled it rather than only writing to the atom.
      await expect(page.locator("tbody").getByText("0.1.0")).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("a duplicate tag is reported inside the dialog", async () => {
      await open.click();
      await tagField.fill("0.1.0");
      await page.getByRole("button", { name: "Create" }).click();

      // Still open, still holding the typed tag, with the reason in it.
      await expect(tagField).toBeVisible({ timeout: 15_000 });
      await expect(tagField).toHaveValue("0.1.0");
      await expect(tagField).toHaveAttribute("aria-invalid", "true");

      // And the list did not grow behind it.
      await expect(page.locator("tbody").getByText("0.1.0")).toHaveCount(1);
    });
  });

  test("the table filters by state and sorts tags by number", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `reltab${t}@example.com`, "RelTest123!");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `RT${t}`.slice(0, 20),
    );

    // Created in version order, which is `number` order and NOT text order.
    await post(page, `/api/createRelease/${projectId}`, { tag: "0.9.0" });
    const mid = await post<Release>(page, `/api/createRelease/${projectId}`, {
      tag: "0.28.0",
    });
    await post(page, `/api/createRelease/${projectId}`, { tag: "1.0.0" });
    await post(page, `/api/publishRelease/${mid.id}`, {});

    await page.goto(`/${slug}/releases`);

    const tagColumn = async () =>
      await page
        .locator("tbody tr")
        .evaluateAll((rows) =>
          rows.map(
            (row) => row.querySelectorAll("td")[1]?.textContent?.trim() ?? "",
          ),
        );

    await test.step("the tag column orders by number, not as text", async () => {
      // Scoped to `thead`: the toolbar's "New Release" action is on this page
      // too, and an unscoped name match finds both.
      const header = page.locator("thead").getByRole("button", {
        name: "Release",
      });
      await expect(header).toBeVisible({ timeout: 15_000 });
      await header.click();
      await expect
        .poll(tagColumn, { timeout: 15_000 })
        .toEqual(["0.9.0", "0.28.0", "1.0.0"]);
    });

    await test.step("the state filter replaces the two headings", async () => {
      // Open and released used to be two sections. A table is one flat list,
      // so the split became a derived two-value filter — and two is the
      // whole vocabulary, because nothing pauses.
      // The only combobox on the page: the toolbar's other filter is a text
      // input, and the table's page-size picker only appears once there is
      // more than one page.
      const stateFilter = page.getByRole("combobox").first();
      await stateFilter.click();
      await page.getByRole("option", { name: "Released" }).click();
      await expect.poll(tagColumn, { timeout: 15_000 }).toEqual(["0.28.0"]);

      await stateFilter.click();
      await page.getByRole("option", { name: "Open" }).click();
      await expect
        .poll(tagColumn, { timeout: 15_000 })
        .toEqual(["0.9.0", "1.0.0"]);
    });
  });
});
