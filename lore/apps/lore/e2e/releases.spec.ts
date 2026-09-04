import type { Page } from "@playwright/test";

import { compareReleaseTags } from "../src/api/releaseOrder.ts";
import { expect, test } from "./_fixtures.ts";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
  setProjectFeature,
} from "./_helpers";

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

    // ── The detail page resolves by TAG, and `?tab=` deep-links ───────────
    // The page is a plate over four tabs and opens on Overview, so what is
    // IN the release is one tab across. `?tab=contents` is asserted rather
    // than a click on purpose: `useDetailTab` binds the selection to the URL
    // precisely so "that release's contents" is a link somebody can share,
    // and a click would never exercise that.
    await page.goto(`/${slug}/releases/0.1.0?tab=contents`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("The big feature").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(`Loose${t}`).first()).toBeVisible();

    // The plate reads the same release from the store, with no round-trip.
    await expect(page.getByText("0.1.0").first()).toBeVisible();

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
    await page.goto(`/${slug}/releases/0.1.0?tab=contents`);
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
    // Editing a record is not offered either - the plate hides the button
    // rather than disabling it, because the server refuses the write anyway.
    await expect(page.getByRole("button", { name: /^edit$/i })).toHaveCount(0);
  });

  test("answers in version order, not in creation order", async ({ page }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    await registerAndVerify(page, `relord${t}@example.com`, "RelTest123!");
    const { id: projectId } = await createProjectViaWizard(
      page,
      `RO${t}`.slice(0, 20),
    );

    // Created OUT of version order on purpose. `number` is a `$sequence`, so
    // creating `0.10.0` first makes creation order and version order disagree
    // - which is the only arrangement where text, `number` and a parsed
    // version give three different answers. Created in version order, all
    // three agree and the assertion passes against any of them (quest #1640).
    await post(page, `/api/createRelease/${projectId}`, { tag: "0.10.0" });
    await post(page, `/api/createRelease/${projectId}`, { tag: "0.9.0" });

    const releases = await listReleases(page, projectId);

    // The endpoint itself sorts by version now (#1745). It used to answer in
    // `number` order and leave every consumer to re-sort, which is how the
    // roadmap, the release filter and both release controls all ended up
    // showing creation order.
    expect(releases.map((r) => r.tag)).toEqual(["0.9.0", "0.10.0"]);

    // `number` still records creation order, which is exactly why it could
    // never be the version order: here the two disagree.
    const byNumber = [...releases].sort((a, b) => a.number - b.number);
    expect(byNumber.map((r) => r.tag)).toEqual(["0.10.0", "0.9.0"]);

    // And the comparator the tables sort their own columns with agrees with
    // what the endpoint already did.
    const byVersion = [...releases].sort((a, b) =>
      compareReleaseTags(a.tag, b.tag),
    );
    expect(byVersion.map((r) => r.tag)).toEqual(["0.9.0", "0.10.0"]);
  });

  /**
   * The page is an `AlephaTable` now, shaped like Epics. These are the two
   * affordances the rebuild added, and the ones a card list could not have.
   *
   * ⚠️ The sort assertion is the same trap as the data-level test above, one
   * layer up. The header says "Release" and shows tags, and it must order
   * them by parsed version. Its fixture creates them OUT of version order
   * (`1.0.0` before `0.29.0`, the arrangement the reporter of #1640 had),
   * so neither a text comparator nor the old `number` proxy can pass it.
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
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Create" })
        .click();

      // The table fetches its own rows, so this is the assertion that the
      // create actually signalled it rather than only writing to the atom.
      await expect(page.locator("tbody").getByText("0.1.0")).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("a duplicate tag is reported inside the dialog", async () => {
      await open.click();
      await tagField.fill("0.1.0");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Create" })
        .click();

      // Still open, still holding the typed tag, with the reason in it.
      await expect(tagField).toBeVisible({ timeout: 15_000 });
      await expect(tagField).toHaveValue("0.1.0");
      await expect(tagField).toHaveAttribute("aria-invalid", "true");

      // And the list did not grow behind it.
      await expect(page.locator("tbody").getByText("0.1.0")).toHaveCount(1);
    });
  });

  /**
   * The Releases chrome: where the entry sits in the sidebar, and that the
   * header's create menu can reach it.
   *
   * Two quests' worth of assertions in one test on purpose. Both need only a
   * project with feature toggles, and on CI (1-2 workers) the register +
   * wizard setup costs more than everything either of them asserts.
   *
   * ⚠️ The feature shape in the second half is the whole point of it:
   * releases ON with epics, folios and feedback OFF. `hasCreateAction`
   * decides whether the create chevron renders at all, so an entry added to
   * the menu without being counted there is an entry inside a menu with no
   * way to open it. Any other shape has some other feature holding the
   * chevron open and would pass either way.
   *
   * The sidebar half is asserted as ORDER among the project's own nav links
   * rather than by group, because the groups are unlabelled by design and so
   * have nothing in the DOM to name them. It is worth pinning because the
   * entry has now moved twice: Record originally, Work after epic #14,
   * Record again at the owner's request.
   */
  test("sits between Folios and Reports, and is reachable from the create menu", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `relchrome${t}@example.com`, "RelTest123!");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `RC${t}`.slice(0, 20),
    );
    await setProjectFeature(page, projectId, "milestones", true);
    await setProjectFeature(page, projectId, "folios", true);

    const navOrder = async () =>
      await page
        .locator(`a[href^="/${slug}/"]`)
        .evaluateAll(
          (links, slug) =>
            links
              .map((a) => a.getAttribute("href") ?? "")
              .filter((href) =>
                [
                  `/${slug}/folios`,
                  `/${slug}/releases`,
                  `/${slug}/reports`,
                ].includes(href),
              ),
          slug,
        );

    await test.step("it sits between Folios and Reports", async () => {
      await page.goto(`/${slug}/quests`);
      await expect
        .poll(navOrder, { timeout: 15_000 })
        .toEqual([`/${slug}/folios`, `/${slug}/releases`, `/${slug}/reports`]);
    });

    await test.step("and still reads sensibly with folios off", async () => {
      // The quest worried this could leave Record holding one item. It
      // cannot: Reports has no feature gate at all, so Record always carries
      // at least it, and the empty-group `.filter` never fires here.
      await setProjectFeature(page, projectId, "folios", false);
      await setProjectFeature(page, projectId, "epics", false);
      await setProjectFeature(page, projectId, "feedback", false);
      await page.goto(`/${slug}/quests`);
      await expect
        .poll(navOrder, { timeout: 15_000 })
        .toEqual([`/${slug}/releases`, `/${slug}/reports`]);
    });

    await test.step("the create menu carries this entry alone", async () => {
      // The header is one "+" since #1684, its menu leading with Create
      // Quest; the release entry sits behind it like every other create.
      const plus = page.getByTestId("project-create-menu");
      await expect(plus).toBeVisible({ timeout: 15_000 });
      await plus.click();

      const item = page.getByRole("menuitem", { name: "New Release" });
      await expect(item).toBeVisible({ timeout: 10_000 });
      // The neighbours really are off, so this entry is the only create
      // beside New Quest.
      await expect(
        page.getByRole("menuitem", { name: "New Epic" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("menuitem", { name: "New Folio" }),
      ).toHaveCount(0);

      await item.click();

      // It opens #1635's dialog rather than a second create surface, and
      // creating from here lands on the release itself, the way New Epic
      // opens the epic it just made.
      await page.getByLabel("Tag").fill("2.0.0");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Create" })
        .click();

      await expect(page).toHaveURL(/\/releases\/2\.0\.0$/, {
        timeout: 15_000,
      });
    });
  });

  test("the table filters by state and sorts tags by version", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `reltab${t}@example.com`, "RelTest123!");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `RT${t}`.slice(0, 20),
    );

    // Created OUT of version order, and out of text order too: creation gives
    // `0.28.0, 1.0.0, 0.29.0, 0.9.0, demo-1`, text gives `0.28.0` first, and
    // only a parsed version gives the order asserted below. `demo-1` is here
    // because the New Release hint offers it, so a tag that is not a version
    // has to have a defined place rather than landing among the 1.x.
    const mid = await post<Release>(page, `/api/createRelease/${projectId}`, {
      tag: "0.28.0",
    });
    await post(page, `/api/createRelease/${projectId}`, { tag: "1.0.0" });
    await post(page, `/api/createRelease/${projectId}`, { tag: "0.29.0" });
    await post(page, `/api/createRelease/${projectId}`, { tag: "0.9.0" });
    await post(page, `/api/createRelease/${projectId}`, { tag: "demo-1" });
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

    await test.step("the tag column orders by version, not by creation or as text", async () => {
      // Scoped to `thead`: the toolbar's "New Release" action is on this page
      // too, and an unscoped name match finds both.
      const header = page.locator("thead").getByRole("button", {
        name: "Release",
      });
      await expect(header).toBeVisible({ timeout: 15_000 });

      // The table opens on `defaultSort`, which is this column descending.
      // `demo-1` leads because a tag that is not a version sorts after every
      // one that is, so reversing puts it first.
      await expect
        .poll(tagColumn, { timeout: 15_000 })
        .toEqual(["demo-1", "1.0.0", "0.29.0", "0.28.0", "0.9.0"]);

      // ⚠️ TWO clicks, not one. `toggleSort` cycles asc → desc → NO SORT, and
      // this column starts descending, so the first click clears the sort and
      // the rows fall back to creation order. That fallback is what the
      // pre-#1640 version of this test was actually asserting: its fixture
      // was created in version order, so "no sort" and "ascending" produced
      // the same five rows and the assertion could not tell them apart.
      await header.click();
      await header.click();
      await expect
        .poll(tagColumn, { timeout: 15_000 })
        .toEqual(["0.9.0", "0.28.0", "0.29.0", "1.0.0", "demo-1"]);
    });

    await test.step("the state filter replaces the two headings", async () => {
      // Open and released used to be two sections. A table is one flat list,
      // so the split became a derived filter over the same two values,
      // because nothing pauses.
      //
      // ⚠️ This step has now been written for both arities, so the history
      // is worth carrying. It was a scalar; feedback #2092 made it a MULTI
      // because a clearable scalar drew "All states" as a third pickable
      // row; feedback #2098 deleted that row from `control-select` itself
      // and the field went back to a scalar, because open and released are
      // exhaustive and mutually exclusive - picking both was the same query
      // as picking neither. So a second pick REPLACES again, and each one
      // needs the popup reopened.
      //
      // The only combobox on the page: the toolbar's other filter is a text
      // input, and the table's page-size picker only appears once there is
      // more than one page.
      const stateFilter = page.getByRole("combobox").first();
      await stateFilter.click();
      await page.getByRole("option", { name: "Released" }).click();
      await expect.poll(tagColumn, { timeout: 15_000 }).toEqual(["0.28.0"]);

      // Replaces rather than adds, which is the whole point of the arity:
      // there is no reachable state that means "open and released" and so
      // none that says "2 states" while meaning "no filter".
      await stateFilter.click();
      await page.getByRole("option", { name: "Open" }).click();
      await expect
        .poll(tagColumn, { timeout: 15_000 })
        .toEqual(["0.9.0", "0.29.0", "1.0.0", "demo-1"]);

      // Back to every state by pressing the chosen row again - the only way
      // back now, and the reason #2098 could delete the clear row at all.
      // The trigger carries the label that row used to.
      await stateFilter.click();
      await page.getByRole("option", { name: "Open" }).click();
      await expect
        .poll(tagColumn, { timeout: 15_000 })
        .toEqual(["0.9.0", "0.28.0", "0.29.0", "1.0.0", "demo-1"]);
      await expect(stateFilter).toContainText("All states");
    });
  });
});
