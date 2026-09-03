import { expect, test } from "@playwright/test";

import {
  addKanbanColumn,
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * The Kanban board as a surface of its own (epic #2).
 *
 * `quest.spec.ts` owns the view bar and the `defaultSurface` landing, since
 * those are about the Quests page as much as this one. What lives here is
 * the board itself: its sidebar entry, how a card reacts to a lifecycle
 * change made in its drawer, and the column configuration behind it.
 *
 * Three of these are regression guards for bugs found by reading the board
 * rather than by using it, so each names the shape it is pinning.
 */
test.describe("Kanban", () => {
  /**
   * #1211. The board had no sidebar entry between the 2026-08 rename and
   * this epic, which is the whole reason the view bar had to be invented:
   * it was unreachable from the UI at all.
   */
  test("the sidebar entry opens the board", async ({ page }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const projectTitle = `KS${t}`.slice(0, 20);

    await registerAndVerify(page, `kbnav${t}@example.com`, "KanbanNav123!");
    const { slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    await page.goto(`/${projectSlug}/quests`);
    await page.locator(`a[href="/${projectSlug}/kanban"]`).first().click();
    await page.waitForURL(`**/${projectSlug}/kanban`, { timeout: 15_000 });
    await expect(page.getByTestId("kanban-board")).toBeVisible({
      timeout: 10_000,
    });
  });

  /**
   * #1222. `KanbanBoard`'s grouping only branched on "new" and "completed",
   * so a shelved quest fell through to the accepted fallback: pressing
   * Shelve — the gesture meaning "I am not doing this" — visibly moved the
   * card FORWARD into In progress, and the drawer stayed open over it.
   *
   * The two assertions are the two halves of the fix, and the second is the
   * one a grouping unit test cannot reach.
   */
  test("shelving from the card drawer removes the card and closes the drawer", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const questTitle = `ShelveCard${t}`;
    const projectTitle = `KSH${t}`.slice(0, 20);

    await registerAndVerify(page, `kbshelve${t}@example.com`, "KanbanShv123!");
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const { shortId } = await apiPost<{ shortId: number }>(
      page,
      "createQuest",
      {
        projectId,
        title: questTitle,
        description: "Seeded so the board has a card to shelve",
        area: "Main",
        priority: "low",
        objectives: [],
        attachments: [],
      },
    );

    await page.goto(`/${projectSlug}/kanban`);
    const card = page.locator(
      `[data-testid="kanban-card"][data-quest-short-id="${shortId}"]`,
    );
    await expect(card).toBeVisible({ timeout: 10_000 });

    await card.click();
    await expect(page.getByRole("button", { name: /^shelve$/i })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: /^shelve$/i }).click();
    await expect(
      page.getByRole("alertdialog", { name: /shelve this quest/i }),
    ).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: /shelve quest/i }).click();

    // The drawer closes rather than sitting open over a card that is no
    // longer on the board. Unassign already did this; Shelve did not.
    await expect(page.getByRole("button", { name: /^unshelve$/i })).toBeHidden({
      timeout: 10_000,
    });

    // And the card is gone from EVERY column — the bug was that it was
    // still on the board, one column further along.
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("kanban-board")).toBeVisible();
  });

  /**
   * #1223. Clicking a card was `setSelectedQuest(quest)`: local state, no
   * URL, and no refetch — a long-lived board edited whatever `getBoard`
   * returned however long ago, and a card could not be linked at all.
   *
   * The deep-link half is the one that matters: it proves the card is a
   * route with a loader rather than a sheet the board opens over itself.
   */
  test("a card has its own URL and survives a reload", async ({ page }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const questTitle = `CardUrl${t}`;
    const projectTitle = `KC${t}`.slice(0, 20);

    await registerAndVerify(page, `kbcard${t}@example.com`, "KanbanCrd123!");
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    const { shortId } = await apiPost<{ shortId: number }>(
      page,
      "createQuest",
      {
        projectId,
        title: questTitle,
        description: "Seeded so the board has a card to open",
        area: "Main",
        priority: "low",
        objectives: [],
        attachments: [],
      },
    );

    await page.goto(`/${projectSlug}/kanban`);
    await page
      .locator(`[data-testid="kanban-card"][data-quest-short-id="${shortId}"]`)
      .click();

    // Opening the card is a navigation, so it is addressable.
    await expect(page).toHaveURL(
      new RegExp(`/${projectSlug}/kanban/${shortId}$`),
      { timeout: 10_000 },
    );
    await expect(page.getByText(questTitle).first()).toBeVisible({
      timeout: 10_000,
    });

    // A deep link opens the card over the board, with the board behind it.
    await page.reload();
    await expect(page.getByText(questTitle).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("kanban-board")).toBeVisible();

    // Closing returns to the board, not to the quest list.
    await page.getByRole("button", { name: /back/i }).first().click();
    await expect(page).toHaveURL(new RegExp(`/${projectSlug}/kanban$`), {
      timeout: 10_000,
    });
    await expect(page.getByTestId("kanban-board")).toBeVisible();
  });

  /**
   * #1639. The filter bar's search was a raw `<input>` with its own border,
   * height and focus ring, next to a hand-positioned icon, where the quests
   * table passes the same concept through `Control`. Adopting `Control`
   * moved search into `filterForm`, which is a real change to how the value
   * is held - so what the bar DOES is pinned here.
   *
   * ⚠️ Nothing covered this bar before. The quest's description says the
   * e2e suite reaches these controls by `data-testid`; it does not, and did
   * not, which is why the rewire had no guard to answer to.
   */
  test("the filter bar searches on each keystroke and resets all of it", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    const projectTitle = `KF${t}`.slice(0, 20);
    const kept = `Keep${t}`;
    const filtered = `Drop${t}`;

    await registerAndVerify(page, `kbfilter${t}@example.com`, "KanbanFlt123!");
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    for (const title of [kept, filtered]) {
      await apiPost(page, "createQuest", {
        projectId,
        title,
        description: "Seeded for the filter bar",
        area: "Main",
        priority: "low",
        objectives: [],
        attachments: [],
      });
    }

    await page.goto(`/${projectSlug}/kanban`);
    await expect(page.getByTestId("kanban-board")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("kanban-card")).toHaveCount(2, {
      timeout: 15_000,
    });

    await test.step("typing filters the board without submitting", async () => {
      // `pressSequentially`, not `fill`: the point is that each keystroke
      // filters. `fill` sets the value in one shot and would pass even if
      // the bar had grown a submit button.
      await page.getByTestId("kanban-search").pressSequentially(kept);
      await expect(page.getByTestId("kanban-card")).toHaveCount(1, {
        timeout: 10_000,
      });
      await expect(page.getByText(kept).first()).toBeVisible();
    });

    await test.step("reset clears the search and brings the board back", async () => {
      // The reset button only exists while something is filtered, which is
      // itself the assertion that search registered as an active filter.
      await page.getByTestId("kanban-filter-reset").click();
      await expect(page.getByTestId("kanban-card")).toHaveCount(2, {
        timeout: 10_000,
      });
      await expect(page.getByTestId("kanban-search")).toHaveValue("");
    });
  });

  /**
   * #1209. The column row was `overflow-hidden` around `min-w-[260px]`
   * children. Seven columns need 1820px, and flex cannot shrink past a
   * min-width, so the rightmost columns were clipped with no way to reach
   * them on a laptop.
   *
   * Asserting `scrollWidth > clientWidth` alone would pass on the broken
   * version too — the content always overflowed. What changed is that the
   * overflow is now reachable, so the test scrolls and checks it moved.
   */
  test("columns past the viewport can be scrolled to", async ({ page }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    const projectTitle = `KSC${t}`.slice(0, 20);

    await registerAndVerify(page, `kbscroll${t}@example.com`, "KanbanScr123!");
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    // A narrow viewport, so the seven columns cannot possibly fit and the
    // test does not depend on the runner's window size.
    await page.setViewportSize({ width: 900, height: 800 });

    // Fill the configurable band: the wizard leaves one "In Progress" lane,
    // so four more reach the cap of five.
    for (const name of ["Review", "Blocked", "Testing", "Staged"]) {
      await addKanbanColumn(page, projectId, name);
    }

    await page.goto(`/${projectSlug}/kanban`);
    await expect(page.getByTestId("kanban-board")).toBeVisible({
      timeout: 10_000,
    });
    // New + five sub-columns + Completed.
    await expect(page.getByTestId("kanban-column")).toHaveCount(7);

    const row = page.getByTestId("kanban-columns");
    const overflows = await row.evaluate(
      (el) => el.scrollWidth > el.clientWidth,
    );
    expect(overflows).toBe(true);

    // The half that was broken: the overflow has to be reachable.
    await row.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    const scrolled = await row.evaluate((el) => el.scrollLeft);
    expect(scrolled).toBeGreaterThan(0);

    // And the last column is actually in view once scrolled there.
    const lastColumn = page.locator(
      '[data-testid="kanban-column"][data-column-key="column:Completed"]',
    );
    await expect(lastColumn).toBeInViewport();
  });

  /**
   * #1210. `reorderKanbanColumns` existed with no caller anywhere, while the
   * settings page rendered a `GripVertical` that was pure decoration —
   * column order could not be changed from the UI at all.
   *
   * ⚠️ The `waitForResponse` is armed BEFORE the drop and awaited before the
   * reload. The drop is optimistic, so the on-screen assertion passes the
   * instant the local array is reordered — well before the POST lands. A
   * reload issued at that point cancels the request in flight, the server
   * keeps the old order, and the feature looks broken; that is exactly how
   * this test failed when it was first written. Same trap the folio tree
   * drag documents in CLAUDE.md.
   */
  test("kanban columns can be reordered from settings", async ({ page }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    const projectTitle = `KR${t}`.slice(0, 20);

    await registerAndVerify(page, `kbreorder${t}@example.com`, "KanbanRdr123!");
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    await addKanbanColumn(page, projectId, "Review");

    await page.goto(`/${projectSlug}/settings/kanban`);
    const rows = page.getByTestId("kanban-settings-column");
    await expect(rows).toHaveCount(2, { timeout: 10_000 });
    await expect(rows.nth(0)).toHaveAttribute(
      "data-column-name",
      "In Progress",
    );
    await expect(rows.nth(1)).toHaveAttribute("data-column-name", "Review");

    // Drag the second row's grip onto the first. dnd-kit's PointerSensor has
    // an 8px activation distance, so the move needs intermediate steps —
    // a single mouse.move would be treated as a click.
    const source = rows.nth(1).getByRole("button", { name: /reorder/i });
    const target = rows.nth(0);
    const from = await source.boundingBox();
    const to = await target.boundingBox();
    if (!from || !to) throw new Error("missing bounding boxes");

    const saved = page.waitForResponse(
      (r) => r.url().includes("reorderKanbanColumns") && r.status() === 200,
      { timeout: 15_000 },
    );

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
      steps: 12,
    });
    await page.mouse.up();

    await expect(rows.nth(0)).toHaveAttribute("data-column-name", "Review", {
      timeout: 10_000,
    });
    await saved;

    // It persisted, rather than reordering a local array.
    await page.reload();
    await expect(rows).toHaveCount(2, { timeout: 10_000 });
    await expect(rows.nth(0)).toHaveAttribute("data-column-name", "Review");
    await expect(rows.nth(1)).toHaveAttribute(
      "data-column-name",
      "In Progress",
    );

    // And the board renders the new order.
    await page.goto(`/${projectSlug}/kanban`);
    const columns = page.getByTestId("kanban-column");
    await expect(columns).toHaveCount(4, { timeout: 10_000 });
    await expect(columns.nth(1)).toHaveAttribute(
      "data-column-key",
      "column:Review",
    );
  });

  /**
   * #1742. The filter bar was clipped out of reach at phone widths.
   *
   * It is a flex line of two items that both refuse to shrink - the form
   * because a `FilterSlot` owns a fixed width, the toggles because they are
   * `whitespace-nowrap` - inside a container that is `overflow-hidden` while
   * the bar itself is `overflow-x: visible`. Measured at 411x845 before the
   * fix: `clientWidth 409` against a `scrollWidth` of 678, with `My cards`,
   * `Overdue` and `No lanes` entirely off-screen and no scrollbar to reach
   * them. 768px was broken too, because the sidebar returns at `md`.
   *
   * The bar wraps rather than scrolls, because `kanbanFiltersAtom` PERSISTS
   * these filters: a phone can inherit a filtered board from a desktop
   * session, so a filter that is set and merely out of sight is a board that
   * looks broken with no visible cause. This asserts what that buys - every
   * control inside the viewport - rather than the class that delivers it.
   */
  test("the filter bar keeps every control on screen at phone width", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const projectTitle = `KW${t}`.slice(0, 20);

    await registerAndVerify(page, `kbwrap${t}@example.com`, "KanbanWrap123!");
    const { slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    await page.setViewportSize({ width: 411, height: 845 });
    await page.goto(`/${projectSlug}/kanban`);
    await expect(page.getByTestId("kanban-board")).toBeVisible({
      timeout: 15_000,
    });

    // The bar itself no longer overflows, so nothing is behind its edge.
    const bar = await page.evaluate(() => {
      const el = document
        .querySelector('[data-testid="kanban-filter-mine"]')
        ?.closest("div.border-b") as HTMLElement | null;
      if (!el) throw new Error("filter bar not found");
      return { clientWidth: el.clientWidth, scrollWidth: el.scrollWidth };
    });
    expect(bar.scrollWidth).toBe(bar.clientWidth);

    // And each control is reachable where it stands, with no scrolling.
    for (const id of [
      "kanban-search",
      "kanban-filter-mine",
      "kanban-filter-due",
      "kanban-lanes",
    ]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, `${id} has no box`).not.toBeNull();
      expect(box!.x, `${id} starts off-screen`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${id} ends off-screen`).toBeLessThanOrEqual(
        411,
      );
    }

    // The toggles actually work from there - the point of reaching them.
    await page.getByTestId("kanban-filter-mine").click();
    await expect(page.getByTestId("kanban-filter-mine")).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 10_000 },
    );
  });

  /**
   * #1743. The column header's controls were bare buttons the size of their
   * own 14px glyph, well under half of WCAG 2.2's 24x24 minimum.
   *
   * They were grown into real 24px boxes rather than given invisible
   * `::before` overlays: the two sit 20px apart centre to centre, so two
   * 24px overlays would intersect and one would swallow the other's edge.
   */
  test("the column header controls meet the 24px minimum target size", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const projectTitle = `KT${t}`.slice(0, 20);

    await registerAndVerify(page, `kbtap${t}@example.com`, "KanbanTap123!");
    const { slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    await page.setViewportSize({ width: 411, height: 845 });
    await page.goto(`/${projectSlug}/kanban`);
    await expect(page.getByTestId("kanban-board")).toBeVisible({
      timeout: 15_000,
    });

    // The collapse button is on every column; the menu only on a configured,
    // editable one, which is why the audit that found this saw only the first.
    for (const id of ["kanban-column-collapse", "kanban-column-menu"]) {
      const targets = page.getByTestId(id);
      const count = await targets.count();
      expect(count, `${id} not rendered`).toBeGreaterThan(0);

      for (let i = 0; i < count; i++) {
        const box = await targets.nth(i).boundingBox();
        expect(box, `${id} ${i} has no box`).not.toBeNull();
        expect(box!.width, `${id} ${i} width`).toBeGreaterThanOrEqual(24);
        expect(box!.height, `${id} ${i} height`).toBeGreaterThanOrEqual(24);
      }
    }
  });
});
