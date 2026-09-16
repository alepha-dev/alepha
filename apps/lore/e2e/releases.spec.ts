import type { Page } from "@playwright/test";

import { compareReleaseTags } from "../src/api/releaseOrder.ts";
import { expect, test } from "./_fixtures.ts";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
  setCapability,
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
 * path parameter — the same reason `setCapability` and `addKanbanColumn`
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
      { options: { work: ["releases"] } },
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
    // The same quest reachable BOTH ways: in the release's epic AND named
    // directly. It must still count once.
    const both = await createQuest(page, projectId, `Both${t}`);
    // Every quest goes in while the epic is a draft, then the epic is marked
    // ready, then one of them is worked: a quest can be accepted only inside
    // a ready or in-progress epic, and that first accept is what starts the
    // epic and freezes its quest set (#Q2223). This seed used to accept
    // inside a draft epic, which is refused as not ready.
    for (const quest of [inEpicDone, inEpicOpen, both]) {
      await post(page, `/api/attachQuest/${epic.id}`, { questId: quest.id });
    }
    await post(page, `/api/setEpicStatus/${epic.id}`, { status: "ready" });
    await completeQuest(page, inEpicDone.id);

    const loose = await createQuest(page, projectId, `Loose${t}`);
    await post(page, `/api/updateQuestById/${loose.id}`, {
      releaseId: first.id,
    });
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

    // ── The Flow tab draws the order the epics ship in ────────────────────
    // A second epic in the same release, after the first. The edge between
    // the two clusters exists only if `getReleaseContents` projects
    // `dependsOn`, which its response schema alone decides: the entity has
    // carried the column all along and drew nothing. The follow-up holds no
    // quest, so the counts asserted below are untouched.
    const followUp = await post<{ id: number; number: number }>(
      page,
      `/api/createEpic/${projectId}`,
      { title: "The follow-up" },
    );
    await post(page, `/api/updateEpic/${followUp.id}`, {
      releaseId: first.id,
      dependsOn: epic.id,
    });
    await page.goto(`/${slug}/releases/0.1.0?tab=flow`);
    await expect(
      page.getByRole("link", { name: /The big feature/ }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("link", { name: /The follow-up/ }),
    ).toBeVisible();
    // A quest inside an epic and the loose one both draw as cards, and a
    // card here is a link to the quest, not a dialog.
    await expect(
      page.getByRole("link", { name: `#Q${inEpicOpen.shortId} Open${t}` }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: `#Q${loose.shortId} Loose${t}` }),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="release-flow-edges"] path'),
    ).not.toHaveCount(0);

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
      { options: { work: ["releases"] } },
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
   * The page is a `DataTable` now, shaped like Epics. These are the two
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
    const { slug } = await createProjectViaWizard(page, `RN${t}`.slice(0, 20), {
      options: { work: ["releases"] },
    });

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
      { options: { work: ["releases"] } },
    );
    await setCapability(page, projectId, "work", {
      options: { releases: true },
    });
    await setCapability(page, projectId, "knowledge", { enabled: true });

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
      await setCapability(page, projectId, "knowledge", { enabled: false });
      await setCapability(page, projectId, "work", {
        options: { epics: false },
      });
      await setCapability(page, projectId, "support", { enabled: false });
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
      // beside New quest.
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

  test("the default release catches unfiled work, and publishing hands it on", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    await registerAndVerify(page, `reldef${t}@example.com`, "RelTest123!");
    const { id: projectId, slug } = await createProjectViaWizard(
      page,
      `RD${t}`.slice(0, 20),
      { options: { work: ["releases"] } },
    );

    // `0.3.0` is created FIRST, out of version order: the default is handed
    // on by parsed tag, and a fixture created in version order could not tell
    // that from "the next release by number".
    const next = await post<Release>(page, `/api/createRelease/${projectId}`, {
      tag: "0.3.0",
    });
    await post<Release>(page, `/api/createRelease/${projectId}`, {
      tag: "0.1.0",
    });
    await post<Release>(page, `/api/createRelease/${projectId}`, {
      tag: "0.2.0",
    });

    /**
     * The plate's own control, not the table's row menu.
     *
     * ⚠️ Base UI leaves `pointer-events: none` on the body after a popover
     * closes, and the row menu is a popover. The plate button is a plain
     * button, so it is the one door that cannot lose a click for a reason
     * that has nothing to do with this feature.
     */
    const setDefaultFrom = async (tag: string) => {
      await page.goto(`/${slug}/releases/${tag}`);
      const trigger = page.getByRole("button", { name: "Set as default" });
      await expect(trigger).toBeVisible({ timeout: 15_000 });
      await trigger.click();
      // ⚠️ `alertdialog`, not `dialog`. The confirm comes from
      // `useDialog().confirm`, which renders an alert dialog; the create
      // dialog above is a real `Dialog` and is `dialog`. The scoping is not
      // optional either way: the confirm button carries the same label as the
      // trigger, because the dialog is where the one-line explanation of what
      // a default release IS gets said.
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Set as default" })
        .click();
      await expect(
        page.getByRole("button", { name: "Clear default" }),
      ).toBeVisible({ timeout: 15_000 });
    };

    /**
     * The default marker, by accessible name.
     *
     * ⚠️ NOT `getByText("Default")`. Since feedback #P2171 the marker is a
     * GLYPH beside the tag rather than a chip below the state, so it carries
     * no visible text at all - the label lives on `aria-label` and the
     * "Default since <date>" on `title`. A text locator finds nothing, which
     * is how this spec caught the change.
     */
    const defaultMarker = (scope = page) =>
      scope.getByRole("img", { name: "Default", exact: true });

    await test.step("the marker lands, and moves off the first when the second takes it", async () => {
      await setDefaultFrom("0.1.0");
      await expect(defaultMarker()).toBeVisible();

      await setDefaultFrom("0.2.0");

      // Read back off the table, which is the surface where the two rows sit
      // side by side and where a swap that left two defaults would show.
      await page.goto(`/${slug}/releases`);
      const defaultRow = page
        .locator("tbody tr")
        .filter({ has: defaultMarker() });
      await expect(defaultRow).toHaveCount(1, { timeout: 15_000 });
      await expect(defaultRow).toContainText("0.2.0");
    });

    const caught = await createQuest(page, projectId, `Caught${t}`);

    await test.step("a quest completed with no release lands in the default, and says so", async () => {
      // Through the UI rather than the API, because the toast is the third
      // side of "make it visible" and only exists here.
      await page.goto(`/${slug}/quests/${caught.shortId}`);
      const accept = page.getByRole("button", {
        name: /sign and accept|accept.*quest/i,
      });
      await expect(accept).toBeVisible({ timeout: 15_000 });
      await accept.click();
      await page
        .getByRole("button", { name: /^complete quest$/i })
        .first()
        .click();
      await page
        .getByRole("button", { name: /complete without summary/i })
        .click();

      await expect(page.getByText("Completed in 0.2.0")).toBeVisible({
        timeout: 15_000,
      });

      // The badge, the completion and the release page's contents are three
      // surfaces that have to agree, and two of them disagreeing is this
      // epic's central risk.
      await expect
        .poll(
          async () =>
            (await listReleases(page, projectId)).find((r) => r.tag === "0.2.0")
              ?.progress,
          { timeout: 15_000 },
        )
        .toMatchObject({ completed: 1, total: 1 });

      await page.goto(`/${slug}/releases/0.2.0?tab=contents`);
      await expect(page.getByText(`Caught${t}`).first()).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("publishing the default hands it to the next release", async () => {
      await page.goto(`/${slug}/releases/0.2.0`);
      await page.getByRole("button", { name: "Publish" }).first().click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Publish" })
        .click();
      // ⚠️ Wait for the plate to answer before navigating. The click is
      // fire-and-forget from here, so `page.goto` races the POST, and the
      // table then paints two OPEN releases and fails on a publish that was
      // still in flight. Reopen replacing Publish is the plate's own signal
      // that the write landed.
      await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible({
        timeout: 15_000,
      });

      await page.goto(`/${slug}/releases`);
      const rows = page.locator("tbody tr");
      await expect(rows).toHaveCount(3, { timeout: 15_000 });
      await expect(rows.filter({ hasText: "Released" })).toHaveCount(1, {
        timeout: 15_000,
      });
      // `0.3.0`, the lowest open release above `0.2.0`. Never `0.1.0`, which
      // is open too: intake does not move backwards.
      const defaultRow = rows.filter({ has: defaultMarker() });
      await expect(defaultRow).toHaveCount(1, { timeout: 15_000 });
      await expect(defaultRow).toContainText("0.3.0");
    });

    await test.step("publishing the last one in line clears it", async () => {
      // Through the API: the plate's Publish flow is the step above, and this
      // one is about what the table shows once nothing is next in line.
      await post(page, `/api/publishRelease/${next.id}`, {});

      await page.goto(`/${slug}/releases`);
      const rows = page.locator("tbody tr");
      // ⚠️ Wait for the table to PAINT before counting an absence.
      // `toHaveCount(0)` is trivially true on a tbody that has not rendered
      // yet, so a publish that silently failed would read as a cleared
      // default - which is exactly how this step passed while the release
      // was still open.
      await expect(rows).toHaveCount(3, { timeout: 15_000 });
      await expect(rows.filter({ hasText: "Released" })).toHaveCount(2, {
        timeout: 15_000,
      });
      await expect(rows.filter({ has: defaultMarker() })).toHaveCount(0);
    });

    await test.step("with no default, a quest still completes and lands nowhere", async () => {
      const loose = await createQuest(page, projectId, `Loose${t}`);
      await completeQuest(page, loose.id);

      // Above all, that it COMPLETES: a quest that will not close because of
      // a planning convenience is worse than a missed attachment.
      const rows = await listReleases(page, projectId);
      expect(rows.find((r) => r.tag === "0.1.0")?.progress).toMatchObject({
        completed: 0,
        total: 0,
      });
      // FROZEN at publish, and never recomputed: `0.2.0` shipped one quest
      // and still says one, which is the whole reason publishing clears the
      // default rather than leaving intake pointed at a closed record.
      expect(rows.find((r) => r.tag === "0.2.0")?.progress).toMatchObject({
        completed: 1,
        total: 1,
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
      { options: { work: ["releases"] } },
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

    // ⚠️ The column index is read off the header rather than hardcoded. It
    // was `td[1]` until bulk delete (#Q2288) gave this table its first
    // checkbox column, which moved every cell one to the right, so a fixed
    // index would read the State chip instead of the tag. The Epics spec hit
    // the same shift with feedback #2086. A throw is deliberate: a missing
    // header must fail loudly rather than read `td[-1]` as every row empty.
    const tagColumn = async () =>
      await page.locator("table").evaluate((table) => {
        const headers = [...table.querySelectorAll("thead th")];
        const index = headers.findIndex(
          (th) => th.textContent?.trim() === "Release",
        );
        if (index < 0) throw new Error("no Release column in the header");
        return [...table.querySelectorAll("tbody tr")].map(
          (row) => row.querySelectorAll("td")[index]?.textContent?.trim() ?? "",
        );
      });

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
      // Optional, so off the bar until it is added from the funnel-plus menu
      // (#E58). Adding it opens its list, so the first option is the next
      // click; after that the trigger, named by the filter, reopens it.
      const stateFilter = page.getByRole("combobox", { name: "State" });
      await page.getByRole("button", { name: "Add filter" }).click();
      await page.getByRole("menuitem", { name: /^State/ }).click();
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

  /**
   * Epic #E56, from a row: the create entries the frontier rule offers, and
   * the two deletes.
   *
   * `ProjectReleases.browser.spec.tsx` covers the same menu on a fake client.
   * What only a real server can prove is here: the pre-filled create goes
   * through the real `createRelease` and its `(projectId, tag)` unique index,
   * a delete really detaches (`epics.releaseId` and `quests.releaseId` are
   * `ON DELETE SET NULL`, and only a real database runs the clause), and
   * deleting the default leaves the project with none.
   */
  test.describe("from the row menu", () => {
    /**
     * Open one row's menu. The row is found by its tag anchor, whose name is
     * exactly the tag, so `0.1.0` never matches `0.1.1`.
     */
    const openRowMenu = async (page: Page, tag: string) => {
      const row = page
        .locator("tbody tr")
        .filter({ has: page.getByRole("link", { name: tag, exact: true }) });
      await row.getByRole("button", { name: "Open row actions" }).click();
    };

    test("creates the next version from a row, without leaving the list", async ({
      page,
    }) => {
      test.setTimeout(120_000);

      const t = Date.now();
      await registerAndVerify(page, `relrow${t}@example.com`, "RelTest123!");
      const { id: projectId, slug } = await createProjectViaWizard(
        page,
        `RW${t}`.slice(0, 20),
        { options: { work: ["releases"] } },
      );

      const first = await post<Release>(
        page,
        `/api/createRelease/${projectId}`,
        { tag: "0.1.0" },
      );
      await post(page, `/api/publishRelease/${first.id}`, {});

      await page.goto(`/${slug}/releases`);
      await expect(
        page.getByRole("link", { name: "0.1.0", exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      await test.step("a published release alone offers all three bumps", async () => {
        await openRowMenu(page, "0.1.0");
        // Three entries are grouped, and the group opens on hover or click.
        await page.getByRole("menuitem", { name: "Create release" }).click();
        for (const tag of ["0.1.1", "0.2.0", "1.0.0"]) {
          await expect(
            page.getByRole("menuitem", { name: `Create ${tag}` }),
          ).toBeVisible();
        }
      });

      await test.step("an entry opens the dialog holding its tag, and creates it", async () => {
        await page.getByRole("menuitem", { name: "Create 0.2.0" }).click();

        const dialog = page.getByRole("dialog");
        await expect(dialog.getByRole("textbox")).toHaveValue("0.2.0");

        await dialog.getByRole("button", { name: "Create" }).click();

        // The row appears only once the real `createRelease` answered and
        // the table refetched, so this is the barrier for everything below.
        await expect(
          page.getByRole("link", { name: "0.2.0", exact: true }),
        ).toBeVisible({ timeout: 15_000 });
        // The reader is planning on a list, so the table's mount of the
        // dialog does not navigate. The header's mount does, on purpose.
        await expect(page).toHaveURL(new RegExp(`/${slug}/releases$`));
        expect((await listReleases(page, projectId)).map((r) => r.tag)).toEqual(
          expect.arrayContaining(["0.1.0", "0.2.0"]),
        );
      });

      await test.step("the older row keeps only its patch once 0.2.0 exists", async () => {
        // 0.2.0 is the frontier of major 0 and of the project now, so the
        // minor and the major moved to it. The patch of 0.1 stays here.
        //
        // Reloaded first: Base UI leaves `pointer-events: none` on the body
        // after the dialog closes, which silently eats the next click.
        await page.goto(`/${slug}/releases`);
        await expect(
          page.getByRole("link", { name: "0.2.0", exact: true }),
        ).toBeVisible({ timeout: 15_000 });
        await openRowMenu(page, "0.1.0");
        await expect(
          page.getByRole("menuitem", { name: "Create 0.1.1" }),
        ).toBeVisible({ timeout: 15_000 });
        await expect(
          page.getByRole("menuitem", { name: "Create release" }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("menuitem", { name: "Create 0.2.0" }),
        ).toHaveCount(0);
      });
    });

    test("deletes a release with work in it, then a selection", async ({
      page,
    }) => {
      test.setTimeout(120_000);

      const t = Date.now();
      await registerAndVerify(page, `reldel${t}@example.com`, "RelTest123!");
      const { id: projectId, slug } = await createProjectViaWizard(
        page,
        `RX${t}`.slice(0, 20),
        { options: { work: ["releases"] } },
      );

      const doomed = await post<Release>(
        page,
        `/api/createRelease/${projectId}`,
        { tag: "0.3.0" },
      );
      await post(page, `/api/createRelease/${projectId}`, { tag: "0.4.0" });
      await post(page, `/api/createRelease/${projectId}`, { tag: "0.5.0" });

      // The default, over its own PUT route: `post` only speaks POST.
      await page.evaluate(
        async ({ projectId, releaseId }) => {
          const r = await fetch(`/api/projects/${projectId}/releases/default`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ releaseId }),
          });
          if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
        },
        { projectId, releaseId: doomed.id },
      );

      // An epic and a loose quest, attached the way the first test does.
      const epic = await post<{ id: number; number: number }>(
        page,
        `/api/createEpic/${projectId}`,
        { title: `Doomed epic ${t}` },
      );
      await post(page, `/api/updateEpic/${epic.id}`, { releaseId: doomed.id });
      const loose = await createQuest(page, projectId, `Loose${t}`);
      await post(page, `/api/updateQuestById/${loose.id}`, {
        releaseId: doomed.id,
      });

      await page.goto(`/${slug}/releases`);
      await expect(
        page.getByRole("link", { name: "0.3.0", exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      await test.step("the default release says what its delete costs, and goes", async () => {
        await openRowMenu(page, "0.3.0");
        await page.getByRole("menuitem", { name: "Delete" }).click();

        // ⚠️ `alertdialog`: the confirm comes from `useDialog().confirm`.
        const confirm = page.getByRole("alertdialog");
        await expect(confirm).toContainText("detached");
        await expect(confirm).toContainText("default release");

        await confirm.getByRole("button", { name: "Delete" }).click();

        // Gone only once the real delete answered and the table refetched,
        // which is also what makes the navigation in the next step safe.
        await expect(
          page.getByRole("link", { name: "0.3.0", exact: true }),
        ).toHaveCount(0, { timeout: 15_000 });
        // Nothing on the delete path picks a successor.
        await expect(
          page.getByRole("img", { name: "Default", exact: true }),
        ).toHaveCount(0);
      });

      await test.step("its epic and quest survive, detached", async () => {
        const quest = (await page.evaluate(async (id) => {
          const r = await fetch(`/api/getQuestById/${id}`, {
            credentials: "include",
          });
          return r.json();
        }, loose.id)) as { id: number; releaseId?: number | null };
        expect(quest.id).toBe(loose.id);
        expect(quest.releaseId ?? null).toBeNull();

        await page.goto(`/${slug}/epics/${epic.number}`);
        const control = page.locator("aside").getByRole("combobox");
        await expect(control).toContainText("None", { timeout: 15_000 });
      });

      await test.step("a selection of two goes in one confirm", async () => {
        await page.goto(`/${slug}/releases`);
        for (const tag of ["0.4.0", "0.5.0"]) {
          const row = page.locator("tbody tr").filter({
            has: page.getByRole("link", { name: tag, exact: true }),
          });
          await row.getByRole("checkbox").click();
        }

        await page.getByRole("button", { name: "Delete", exact: true }).click();
        const confirm = page.getByRole("alertdialog");
        await expect(confirm).toContainText("Delete 2 releases?");
        await confirm
          .getByRole("button", { name: "Delete 2 releases" })
          .click();

        await expect(page.getByText("2 deleted.")).toBeVisible({
          timeout: 15_000,
        });
        await expect(
          page.locator("tbody tr").filter({ hasText: "0.4.0" }),
        ).toHaveCount(0);
        await expect(
          page.locator("tbody tr").filter({ hasText: "0.5.0" }),
        ).toHaveCount(0);
        expect(await listReleases(page, projectId)).toEqual([]);
      });
    });
  });
});
