import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * The four tree gestures a jsdom spec proves nothing about.
 *
 * The rule they exist under: a unit or jsdom spec proves the COMPONENT, never
 * the surface. Three of these four have already been measured failing that
 * way inside this epic. The drop zones need a stubbed `getBoundingClientRect`
 * and a hand-built `MouseEvent`, because jsdom implements no `DragEvent` and
 * silently drops `clientY`. The context menu is a portal jsdom will not lay
 * out. And the rename guard's own case passed with the guard DELETED when it
 * was driven through the tree, because React flushes the discrete Escape
 * synchronously and unmounts the input before any blur can reach it.
 *
 * They live here rather than in an application's suite so that a break in the
 * shared component fails in the package that owns it, without an app's auth,
 * database and router in the way.
 */

/**
 * ⚠️ A manual mouse sequence, not `locator.dragTo()`.
 *
 * Chromium only converts HELD mouse movement into drag events, so a single
 * `dragTo` hop leaves the drop target without a `dragover` and the row lands
 * nowhere. The same finding is written on `apps/lore`'s own tree drag case.
 *
 * `ratio` is a fraction of the target row's height, because that is what the
 * zones are: a branch splits 28% / 44% / 28% into before / inside / after, and
 * a leaf splits in half with no inside area.
 */
const dragOnto = async (
  page: Page,
  source: Locator,
  target: Locator,
  ratio: number,
  /**
   * Runs while the pointer is still down and over the target, which is the
   * only moment the drop markers exist.
   */
  whileOver?: () => Promise<void>,
): Promise<void> => {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("tree row bounding boxes missing");

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // A first held move is what starts the drag at all.
  await page.mouse.move(
    from.x + from.width / 2,
    from.y + from.height / 2 + 10,
    { steps: 5 },
  );
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * ratio, {
    steps: 10,
  });
  // ⚠️ A second, tiny move inside the SAME zone, and it is not padding.
  // Chromium samples `dragover` on its own clock rather than per interpolated
  // step, so the last event of a multi-step move routinely fires a few pixels
  // short of where the pointer stopped: arriving at a branch row from below,
  // the final `dragover` lands in its bottom 28% and the marker reads "after"
  // while the pointer sits in the middle. Measured: the correct marker appears
  // on the very next event. The drop itself is unaffected, which is why a spec
  // asserting only the outcome would never have noticed.
  await page.mouse.move(to.x + to.width / 2 + 2, to.y + to.height * ratio, {
    steps: 2,
  });
  await page.waitForTimeout(150);
  await whileOver?.();
  await page.mouse.up();
  await page.waitForTimeout(200);
};

/**
 * The drag-and-drop specimen is the second of the three trees on the page.
 */
const dragTree = (page: Page): Locator =>
  page.getByRole("tree", { name: "Files" }).nth(1);

/**
 * The full-editor specimen is the third.
 */
const editorTree = (page: Page): Locator =>
  page.getByRole("tree", { name: "Files" }).nth(2);

const rowIn = (tree: Locator, name: string): Locator =>
  tree
    .locator('[data-slot="tree-view-row"]', {
      hasText: new RegExp(`^${name.replace(".", "\\.")}$`),
    })
    .first();

test.describe("TreeView drag and drop", () => {
  test.beforeEach(async ({ page }) => {
    // Every case starts from the fixture: the specimen mutates its own list,
    // so a shared page would make each case depend on the one before it.
    await page.goto("/blocks/tree");
    await expect(page.getByRole("tree", { name: "Files" })).toHaveCount(3);
  });

  test("a leaf dropped inside a branch lands there", async ({ page }) => {
    const tree = dragTree(page);
    const src = rowIn(tree, "src");
    await src.scrollIntoViewIfNeeded();

    await dragOnto(page, rowIn(tree, "LICENSE"), src, 0.5, async () => {
      // The middle 44% of a branch row is the "inside" zone, and the ring
      // is how it says so.
      await expect(src).toHaveClass(/ring-inset/);
    });

    await expect(page.getByTestId("resolved-parent")).toContainText(
      "LICENSE is now in src",
    );
  });

  test("a leaf dropped between two rows takes their parent", async ({
    page,
  }) => {
    const tree = dragTree(page);
    const target = rowIn(tree, "file-1.ts");
    await target.scrollIntoViewIfNeeded();

    // ⚠️ `LICENSE` is the row immediately BELOW `file-1.ts`, and adjacency is
    // the point: a drag needs both boxes on screen at once, and picking two
    // rows several apart in a tree taller than the pane leaves the source
    // scrolled out, where `boundingBox()` still answers and the mouse lands
    // nowhere. That reads as a drag that did nothing.
    //
    // The bottom half of a LEAF is "after", which resolves to that leaf's own
    // parent - one level deeper than where LICENSE starts.
    await dragOnto(page, rowIn(tree, "LICENSE"), target, 0.85, async () => {
      await expect(
        target.locator('[data-slot="tree-view-drop-after"]'),
      ).toBeVisible();
    });

    await expect(page.getByTestId("resolved-parent")).toContainText(
      "LICENSE is now in level 1",
    );
  });

  test("a branch dropped into its own subtree is refused, with no marker", async ({
    page,
  }) => {
    // `nodeHolds`, the guard that keeps a drop from orphaning a whole
    // branch. The component withholds the marker for it too, because
    // `resolveDrop` is going to refuse the drop and a marker would be
    // promising a move that never happens.
    const tree = dragTree(page);
    const inner = rowIn(tree, "level 2");
    await inner.scrollIntoViewIfNeeded();

    await dragOnto(page, rowIn(tree, "src"), inner, 0.5, async () => {
      await expect(inner).not.toHaveClass(/ring-inset/);
      await expect(
        tree.locator('[data-slot="tree-view-drop-before"]'),
      ).toHaveCount(0);
      await expect(
        tree.locator('[data-slot="tree-view-drop-after"]'),
      ).toHaveCount(0);
    });

    // Nothing moved, so the line still says what it said at load.
    await expect(page.getByTestId("resolved-parent")).toContainText(
      "nothing moved yet",
    );
  });
});

test.describe("TreeView context menu", () => {
  test("right-click, Rename, Escape leaves the name alone", async ({
    page,
  }) => {
    // ⚠️ Two things jsdom cannot reach at once. The menu is a portal it will
    // not lay out, and the guard being tested is a blur that fires during an
    // unmount - which, driven through the tree in jsdom, never happens,
    // because React flushes the discrete Escape first. Measured: the jsdom
    // version of this case passes with the guard deleted.
    await page.goto("/blocks/tree");
    const tree = editorTree(page);
    const src = rowIn(tree, "src");
    await src.scrollIntoViewIfNeeded();

    await src.click({ button: "right" });

    const rename = page.getByRole("menuitem", { name: "Rename" });
    await expect(rename).toBeVisible();
    await rename.click();

    const input = page.locator('[data-slot="tree-view-rename-input"]');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("src");

    await page.keyboard.type("discarded");
    await page.keyboard.press("Escape");

    await expect(input).toHaveCount(0);
    await expect(rowIn(tree, "src")).toBeVisible();
    await expect(rowIn(tree, "discarded")).toHaveCount(0);
  });

  test("right-click, Rename, Enter commits", async ({ page }) => {
    // The other half, so the case above cannot pass by the rename being
    // broken outright.
    await page.goto("/blocks/tree");
    const tree = editorTree(page);
    const src = rowIn(tree, "src");
    await src.scrollIntoViewIfNeeded();

    await src.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename" }).click();

    const input = page.locator('[data-slot="tree-view-rename-input"]');
    await expect(input).toBeFocused();
    await page.keyboard.type("sources");
    await page.keyboard.press("Enter");

    await expect(rowIn(tree, "sources")).toBeVisible();
    await expect(rowIn(tree, "src")).toHaveCount(0);
  });
});
