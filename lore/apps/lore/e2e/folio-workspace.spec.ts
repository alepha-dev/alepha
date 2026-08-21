import * as fs from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import {
  apiPost,
  createProjectViaWizard,
  emailDir,
  registerAndVerify,
  setProjectFeature,
} from "./_helpers.ts";

/**
 * The three-pane folio workspace — the always-editable surface at
 * `/:projectSlug/folios/:shortId` that replaced the old split between a
 * read-only `FolioView` and a separate `/edit` route (deleted, not
 * redirected).
 *
 * Distinct from `folios.spec.ts`, which covers `FolioBrowser`, the
 * file-manager surface at `/:projectSlug/folios`. Everything here is
 * inside one open folio.
 *
 * Coverage:
 *  - summary round-trip (the one net-new capability: the `summary` column
 *    had no web writer at all before this workspace)
 *  - the inspector's Outline / History / Links tabs
 *  - moving a folio by dragging it onto a directory in the tree pane
 *  - find-in-folio (⌘F): match count, stepping, Escape
 *  - focus mode (⌘.) and the tree toggle (⌘\), including persistence
 *  - `/folios` opening with nothing selected, and creating from the tree
 *
 * The directory-table coverage that used to live in `folios.spec.ts` went
 * with the table itself: `/folios` is the workspace now and the tree is the
 * only way around it. What that spec tested and the tree still does —
 * create, rename, delete, move — is covered here and by `folioTreeModel`'s
 * own unit tests.
 */

test.describe.configure({ mode: "serial" });

test.describe("Folio workspace", () => {
  test.setTimeout(180_000);

  test.beforeAll(() => {
    fs.mkdirSync(emailDir, { recursive: true });
  });

  let page: Page;
  let projectId: number;
  let projectSlug: string;
  const stamp = Date.now();
  const folioTitle = `Ward-${stamp}`.slice(0, 24);
  const otherTitle = `Link-${stamp}`.slice(0, 24);
  const dirName = `Vault-${stamp}`.slice(0, 24);
  const summaryText = `Summary written by the workspace at ${stamp}.`;
  const body = [
    "# The first heading",
    "",
    "A ward holds the door. The ward is old, and the door is older.",
    "",
    "## The second heading",
    "",
    "Nothing else to say about the ward.",
  ].join("\n");

  /**
   * Create a folio through the API and return its workspace URL.
   *
   * Not through the editor on purpose: `fillMarkdownEditor` types into the
   * rich-text contenteditable, where "# A heading" is literal text in a
   * paragraph, not a heading — the markdown would arrive escaped and the
   * Outline tab would have nothing to list. Creating through the browser
   * UI is already covered by `folios.spec.ts`; what these tests need is a
   * folio whose stored markdown is exactly what we wrote.
   */
  const createFolio = async (title: string, content?: string) => {
    const folio = await apiPost<{ shortId: number }>(page, "create", {
      title,
      content: content ?? "",
      projectId,
    });
    return `/${projectSlug}/folios/${folio.shortId}`;
  };

  const inspector = () => page.locator('[data-slot="folio-inspector"]');

  let folioUrl = "";

  test.beforeAll(async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL });
    page = await ctx.newPage();
    await registerAndVerify(page, `ws-${stamp}@example.com`, "GoodPassw0rd");
    ({ id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      `WS${stamp}`.slice(0, 20),
    ));
    folioUrl = await createFolio(folioTitle, body);
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test("01 — summary survives a save and a reload", async () => {
    // The field is hidden unless the project opts in (#137) — the summary is
    // written for agents, so for a reader it is chrome. Turning it on is part
    // of this test's setup, not part of what it asserts.
    await setProjectFeature(page, projectId, "folioSummary");

    await page.goto(folioUrl);
    const summary = page.getByLabel(/summary for agents/i);
    await expect(summary).toBeVisible({ timeout: 15_000 });

    // ⚠️ No Save click and no "Saved …" line to wait for: an existing folio
    // auto-saves (`useFolioAutoSave`, 1.5s after typing stops), and both the
    // button and the status line were removed once that was true. The button
    // survives in create mode ONLY, which this folio is not in.
    //
    // The write still has to be waited for, or the reload below races it and
    // the final assertion measures the reload rather than the save — the same
    // hazard the old status-line wait existed to close. Armed BEFORE the edit
    // that triggers it, like the tree-drag update further down this file.
    const saved = page.waitForResponse(
      (r) => /\/api\/update\//.test(r.url()) && r.status() === 200,
      { timeout: 15_000 },
    );
    await summary.fill(summaryText);
    // Autosave debounces on the values changing, so blurring is not what
    // fires it — the wait is on the request itself.
    await saved;

    await page.reload();
    await page.waitForLoadState("networkidle");
    // The column existed before this workspace, but only an agent (through
    // the MCP) could ever write it — this is the guard on the web writer.
    await expect(page.getByLabel(/summary for agents/i)).toHaveValue(
      summaryText,
      { timeout: 15_000 },
    );
  });

  test("02 — inspector Outline lists the folio's headings", async () => {
    await page.goto(folioUrl);
    await inspector()
      .getByRole("tab", { name: /outline|plan/i })
      .click();

    await expect(
      inspector()
        .getByRole("button", { name: /the first heading/i })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      inspector()
        .getByRole("button", { name: /the second heading/i })
        .first(),
    ).toBeVisible();
  });

  test("03 — inspector History lists a revision", async () => {
    await page.goto(folioUrl);
    await inspector()
      .getByRole("tab", { name: /history|historique/i })
      .click();

    // Test 01 saved once on top of the create, so there is at least one
    // revision to show; the empty state must be gone.
    await expect(
      inspector().getByText(/no revisions yet|aucune révision/i),
    ).toHaveCount(0, { timeout: 15_000 });
    const revisionRows = inspector().getByRole("button", {
      name: /created|edited|créé|modifié/i,
    });
    await expect(revisionRows.first()).toBeVisible({ timeout: 15_000 });
  });

  test("04 — inspector Links shows a backlink from another folio", async () => {
    const shortId = folioUrl.split("/").pop();
    await createFolio(otherTitle, `A pointer to [[#${shortId}]] and nothing.`);

    await page.goto(folioUrl);
    await inspector()
      .getByRole("tab", { name: /links|liens/i })
      .click();

    // Scoped to the inspector on purpose: the tree pane lists every folio
    // in the project, so an unscoped lookup would pass on the tree row and
    // never touch the Links tab at all.
    await expect(
      inspector().getByText(otherTitle, { exact: false }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("05 — ⌘F finds every occurrence and Escape closes the bar", async () => {
    await page.goto(folioUrl);
    // Wait for the BODY, not just the summary field. The summary is part of
    // the always-mounted document column, but the body arrives behind
    // `MarkdownEditor`'s lazy boundary — and `useFolioFind` walks the pane's
    // text nodes ONCE per (element, content) pair. Searching before the
    // body is on screen therefore matches nothing and does not retry when
    // it appears, so this precondition is the difference between a real
    // assertion and a race. (That no-retry behaviour predates the
    // View/Edit editor — the MDXEditor body was lazy in exactly the same
    // way — and is worth fixing separately.)
    await expect(page.getByText("A ward holds the door")).toBeVisible({
      timeout: 20_000,
    });

    await page.keyboard.press("ControlOrMeta+f");
    const input = page.getByPlaceholder(/find in folio|rechercher dans le/i);
    await expect(input).toBeVisible({ timeout: 5_000 });

    // "ward" appears three times in the body (title excluded — the find
    // bar searches the document pane, and the title field is an input).
    await input.fill("ward");
    await expect(page.getByText("1 / 3", { exact: true })).toBeVisible({
      timeout: 5_000,
    });

    await input.press("Enter");
    await expect(page.getByText("2 / 3", { exact: true })).toBeVisible();

    await input.press("Shift+Enter");
    await expect(page.getByText("1 / 3", { exact: true })).toBeVisible();

    await input.press("Escape");
    await expect(input).toHaveCount(0);
  });

  test("06 — ⌘. hides both panes and restores them", async () => {
    await page.goto(folioUrl);
    const tree = page.locator('[data-slot="folio-tree"]');
    await expect(inspector()).toBeVisible({ timeout: 15_000 });
    await expect(tree).toBeVisible();

    await page.keyboard.press("ControlOrMeta+.");
    // The inspector unmounts, the tree only hides — see `FolioWorkspace`'s
    // doc for why the tree has to stay mounted.
    await expect(inspector()).toHaveCount(0);
    await expect(tree).toBeHidden();

    await page.keyboard.press("ControlOrMeta+.");
    await expect(inspector()).toBeVisible({ timeout: 5_000 });
    await expect(tree).toBeVisible();
  });

  test("07 — the tree toggle survives a reload", async () => {
    await page.goto(folioUrl);
    // The tree stays MOUNTED when hidden (its collapse state has to
    // survive), so this is a visibility assertion, never a count one.
    const tree = page.locator('[data-slot="folio-tree"]');
    await expect(tree).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press("ControlOrMeta+\\");
    await expect(tree).toBeHidden();

    await page.reload();
    await page.waitForLoadState("networkidle");
    // An explicit toggle is a preference, kept per browser — the pane must
    // still be closed after a reload.
    await expect(tree).toBeHidden({ timeout: 15_000 });

    await page.keyboard.press("ControlOrMeta+\\");
    await expect(tree).toBeVisible({ timeout: 5_000 });
  });

  test("08 — dragging a folio onto a directory in the tree moves it", async () => {
    // A directory to drop into. Created through the API rather than the UI
    // because the surface that used to offer "New directory" from a
    // toolbar is gone — the tree's own button is covered by test 10, and
    // this test is about the drag.
    await page.goto(folioUrl);
    await page.evaluate(
      async ({ pid, name }) => {
        await fetch(`/api/projects/${pid}/folio/directories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name }),
        });
      },
      { pid: projectId, name: dirName },
    );
    await page.reload();
    const treeRow = (name: string) =>
      page
        .locator('[data-slot="folio-tree-row"]', {
          hasText: new RegExp(`^${name}$`),
        })
        .first();

    await expect(treeRow(folioTitle)).toBeVisible({ timeout: 15_000 });
    await expect(treeRow(dirName)).toBeVisible();

    // Native HTML5 drag & drop (not dnd-kit, which the browser surface
    // uses). A manual mouse sequence, because Chromium only converts held
    // mouse movement into drag events — a single `dragTo` hop leaves the
    // drop target without a `dragover` and the row lands nowhere.
    const source = await treeRow(folioTitle).boundingBox();
    const target = await treeRow(dirName).boundingBox();
    if (!source || !target) throw new Error("tree row bounding boxes missing");
    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2 + 12,
      { steps: 6 },
    );
    // Land on the row's middle band: the top/bottom 28% of a directory row
    // means "reorder before/after", only the centre means "move inside".
    await page.mouse.move(
      target.x + target.width / 2,
      target.y + target.height / 2,
      { steps: 12 },
    );
    // Armed BEFORE the drop, not after: the move is a fire-and-forget
    // `update` the drop handler starts, and navigating first cancels it
    // in flight — which looks exactly like a drop that did nothing.
    const moved = page.waitForResponse(
      (r) => /\/api\/update\//.test(r.url()) && r.status() === 200,
      { timeout: 15_000 },
    );
    await page.mouse.up();
    await moved;

    // Verified against the row itself, not a listing: the directory table
    // that used to prove this is gone. `directoryId` moving is the actual
    // contract the drop is meant to fulfil.
    const shortId = Number(folioUrl.split("/").pop());
    const movedInto = await page.evaluate(
      async ({ pid, sid }) => {
        const r = await fetch(`/api/list?projectId=${pid}&limit=100`, {
          credentials: "include",
        });
        const rows = (await r.json()) as Array<{
          shortId: number;
          directoryId?: string;
        }>;
        return rows.find((f) => f.shortId === sid)?.directoryId ?? null;
      },
      { pid: projectId, sid: shortId },
    );
    expect(movedInto).not.toBeNull();

    // And the tree agrees: the folio now sits one level deeper than root.
    await page.reload();
    await expect(treeRow(folioTitle)).toBeVisible({ timeout: 15_000 });
    const depth = await treeRow(folioTitle).evaluate(
      (el) => Number.parseInt((el as HTMLElement).style.paddingLeft, 10) || 0,
    );
    expect(depth).toBeGreaterThan(8);
  });

  /**
   * Regression guard: opening a folio costs ONE API round-trip.
   *
   * It used to cost three. The route loader batched `getByShortId` +
   * `list` + `listAllDirectories` into one `/api/_batch`, then fired
   * `listBlobs` on its own (it needs the folio's `id`, which only exists
   * after the batch resolves, so it could never join the 10ms
   * `BatchCollector` window), and `FolioHistoryTab` fired `listHistory`
   * from a mount effect — a whole request returning up to ten FULL
   * content snapshots, to render one number in the meta bar that no
   * longer exists (the bar was deleted with the tag feature).
   *
   * All three collapsed: the attachments ride on `getByShortId` as
   * `metadata`, the tree's two lists are seeded by the `/folios` layout
   * loader that necessarily ran first and are not re-fetched inside their
   * freshness window, and the revision rows wait until the History tab is
   * actually opened.
   *
   * Asserted as a count of requests rather than of any one URL: the point
   * is the total, and a future addition that re-splits the call would
   * pass every other test in this file.
   */
  test("09a — opening a folio costs one API request", async () => {
    const row = (name: string) =>
      page
        .locator('[data-slot="folio-tree-row"]', {
          hasText: new RegExp(`^${name}$`),
        })
        .first();

    // Land on a folio FIRST, so what the count below measures is a
    // folio-to-folio navigation and not the surrounding one-time work:
    // the `/folios` layout loader, and the editor's project-wide
    // wiki-link quest list (its own fetch, cached for five minutes).
    await page.goto(folioUrl);
    await expect(row(otherTitle)).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2_000);

    const calls: string[] = [];
    const record = (req: { url: () => string }) => {
      const { pathname, search } = new URL(req.url());
      if (!pathname.startsWith("/api")) return;
      // Telemetry is not what this counts. The sigil ingest fires on every
      // page load and is orthogonal to how many DATA requests a
      // folio-to-folio navigation costs, which is the regression this
      // guards. It never showed up here before `2e9e28fa5` only because
      // the queue's debounce sent it at +5s, past the 2s window below;
      // batching the load into one request moved it inside. Excluding it
      // is what the assertion always meant.
      if (pathname.includes("/sigil")) return;
      calls.push(pathname + search);
    };
    page.on("request", record);
    try {
      await row(otherTitle).click();
      await page.waitForURL(/\/folios\/\d+/, { timeout: 15_000 });
      await page.waitForTimeout(2_000);
    } finally {
      page.off("request", record);
    }

    expect(
      calls,
      `expected one request, got:\n${calls.join("\n")}`,
    ).toHaveLength(1);
    expect(calls[0]).toContain("withBlobs=true");
  });

  test("09 — /folios opens with nothing selected", async () => {
    await page.goto(`/${projectSlug}/folios`);
    await expect(page.locator('[data-slot="folio-tree"]')).toBeVisible({
      timeout: 15_000,
    });
    // The empty state keeps the menubar (#138) — the workspace should not
    // lose its identity on the surface you land on — but not the formatting
    // toolbar, which would be icon buttons that format nothing.
    await expect(page.getByText(/no folio open/i)).toBeVisible();
    await expect(page.locator('[data-slot="folio-menubar"]')).toBeVisible();
    await expect(page.locator('[data-slot="folio-toolbar"]')).toHaveCount(0);
    // By role, not by class: MDXEditor gives its popup container and its
    // placeholder the same classes as the real contenteditable.
    await expect(
      page.getByRole("textbox", { name: /editable markdown/i }),
    ).toHaveCount(0);
  });

  /**
   * Regression guard for #139. `FoliosLayout` mounts the workspace inside a
   * ROW flex container, where a flex item defaults to `flex: 0 1 auto` and
   * sizes to its content — so the workspace silently stopped short of the
   * content area's right edge. Asserted as a measurement rather than a
   * screenshot because the failure was ~260px of dead space, not a visual
   * regression anyone would catch by eye in CI.
   */
  test("08b — the workspace fills the content area at a wide viewport", async () => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(folioUrl);
    await expect(page.locator('[data-slot="folio-menubar"]')).toBeVisible({
      timeout: 15_000,
    });

    const gap = await page.evaluate(() => {
      const right = (sel: string) => {
        const el = document.querySelector(sel);
        return el ? el.getBoundingClientRect().right : 0;
      };
      // The layout `<main>` is the content area the workspace must fill.
      const main = document.querySelector("main");
      return (
        (main?.getBoundingClientRect().right ?? 0) -
        right('[data-slot="folio-menubar"]')
      );
    });

    // 1px of border, not 260px of dead space.
    expect(gap).toBeLessThanOrEqual(2);

    await page.setViewportSize({ width: 1280, height: 900 });
  });

  /**
   * The floating view/edit toggle — all that survives of the deleted meta
   * bar (feedback #62).
   *
   * Two things are asserted that a unit test cannot see. It has to STAY
   * PUT while the document scrolls: it is deliberately a sibling of the
   * scroll container rather than a child, and the child version looks
   * identical until something is long enough to scroll. And the row it
   * used to live in has to be gone — the directory chip, the tag chips
   * and the `#id · N words · N revisions` line, none of which any other
   * test in this file still looks for.
   */
  test("08c — the view/edit toggle floats and outlives the meta bar", async () => {
    await page.goto(folioUrl);
    const toggle = page.getByTestId("markdown-mode-toggle");
    await expect(toggle).toBeVisible({ timeout: 15_000 });

    // The chip row is gone: no directory chip, no "Add a tag", no counters.
    await expect(
      page.getByRole("button", { name: /^Project root$/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /add a tag|ajouter un tag/i }),
    ).toHaveCount(0);
    await expect(page.getByText(/\d+ (words|mots)/)).toHaveCount(0);

    // Give the document something to scroll, then scroll it.
    const box = await toggle.boundingBox();
    await page.evaluate(() => {
      const pane = document.querySelector('[data-slot="folio-document"]')
        ?.parentElement?.parentElement;
      if (pane) pane.scrollTop = pane.scrollHeight;
    });
    await page.waitForTimeout(300);
    const after = await toggle.boundingBox();
    expect(after?.y).toBeCloseTo(box?.y ?? -1, 0);

    // And it still drives the mode — the one job the meta bar's copy had.
    const before = await toggle.getAttribute("data-mode");
    await toggle.click();
    await expect(toggle).not.toHaveAttribute("data-mode", before ?? "");
  });

  /**
   * The numbered gutter, which only the folio BODY opts into.
   *
   * Asserted here rather than in `codeMirrorSetup.browser.spec.ts` because a
   * gutter is DOM: that spec builds a bare `EditorState` on purpose (a view
   * measures layout, and jsdom has no `Range.getClientRects`), so it can see
   * the extension list but never what the extension renders.
   */
  test("08d — the folio body shows line numbers, and only in edit mode", async () => {
    await page.goto(folioUrl);
    const toggle = page.getByTestId("markdown-mode-toggle");
    await expect(toggle).toBeVisible({ timeout: 15_000 });

    // View mode renders through `MarkdownView`, which has no editor at all.
    if ((await toggle.getAttribute("data-mode")) !== "edit") {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute("data-mode", "edit");

    const gutter = page.locator(".cm-lineNumbers");
    await expect(gutter).toBeVisible({ timeout: 15_000 });
    // A real number, not just the element: `lineNumbers()` mounted with no
    // document would render an empty gutter and still match the locator.
    await expect(gutter.getByText("1", { exact: true })).toBeVisible();

    // Back to view and it goes away with the whole editor.
    await toggle.click();
    await expect(toggle).toHaveAttribute("data-mode", "view");
    await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  });

  test("09b — the empty-state menubar keeps its shape, only its enablement changes", async () => {
    await page.goto(`/${projectSlug}/folios`);
    await expect(page.locator('[data-slot="folio-menubar"]')).toBeVisible({
      timeout: 15_000,
    });

    const menubar = page.locator('[data-slot="folio-menubar"]');

    await test.step("Folio: create is live, everything acting on a document is not", async () => {
      await menubar.getByRole("menuitem", { name: "Folio" }).click();
      // Present but disabled, never removed — a menu that changes its item
      // list between states reads as a different surface.
      await expect(
        page.getByRole("menuitem", { name: "New folio" }),
      ).toBeEnabled();
      await expect(
        page.getByRole("menuitem", { name: "New directory" }),
      ).toBeEnabled();
      // Anchored-but-not-terminated: a menu item's accessible name carries
      // its shortcut glyph too ("Save ⌘S"), so `/^save$/` matches nothing.
      for (const name of [/^save/i, /delete folio/i, /export as/i]) {
        await expect(page.getByRole("menuitem", { name })).toBeDisabled();
      }
      await page.keyboard.press("Escape");
    });

    await test.step("View: the pane toggles stay live", async () => {
      await menubar.getByRole("menuitem", { name: "View" }).click();
      await expect(
        page.getByRole("menuitem", { name: /folio tree/i }),
      ).toBeEnabled();
      await expect(
        page.getByRole("menuitem", { name: /^inspector/i }),
      ).toBeEnabled();
      // The mode toggle replaced Rich text / Markdown source. It acts on a
      // document, so with nothing open it is present-but-disabled — the
      // same "shape stays, enablement changes" contract this test exists
      // to pin.
      await expect(
        page.getByRole("menuitem", { name: /toggle preview/i }),
      ).toBeDisabled();

      await page.getByRole("menuitem", { name: /folio tree/i }).click();
      await expect(page.locator('[data-slot="folio-tree"]')).toBeHidden();

      // The toggle persists in localStorage, and these tests share one page
      // in serial mode — put it back so the next test still has a tree.
      await menubar.getByRole("menuitem", { name: "View" }).click();
      await page.getByRole("menuitem", { name: /folio tree/i }).click();
      await expect(page.locator('[data-slot="folio-tree"]')).toBeVisible();
    });
  });

  test("09c — New directory works from the empty-state menubar", async () => {
    await page.goto(`/${projectSlug}/folios`);
    await expect(page.locator('[data-slot="folio-tree"]')).toBeVisible({
      timeout: 15_000,
    });

    await page
      .locator('[data-slot="folio-menubar"]')
      .getByRole("menuitem", { name: "Folio" })
      .click();
    await page.getByRole("menuitem", { name: "New directory" }).click();

    // The tree creates the row and drops straight into inline rename — the
    // reason the menubar routes through the tree's own model rather than
    // instantiating a second one.
    await expect(
      page.locator('[data-slot="folio-tree"]').getByRole("textbox"),
    ).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Enter");
  });

  test("10 — the tree's New folio button starts a folio", async () => {
    await page.goto(`/${projectSlug}/folios`);
    await expect(page.locator('[data-slot="folio-tree"]')).toBeVisible({
      timeout: 15_000,
    });
    await page
      .getByRole("button", { name: /^new folio$/i })
      .first()
      .click();
    // The tree creates the row and navigates straight into it, ready to be
    // renamed — so the editor is mounted and the chrome is back.
    await page.waitForURL(new RegExp(`/${projectSlug}/folios/\\d+`), {
      timeout: 20_000,
    });
    // A brand-new folio opens in Edit mode — there is nothing to read yet,
    // so the author lands with the caret ready rather than on an empty
    // rendered pane. See `FolioWorkspaceContent`'s `mode` initializer.
    await expect(page.locator(".lore-md-edit .cm-content")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/no folio open/i)).toHaveCount(0);
  });

  test("11 — attachments upload to the open folio, not to a directory", async () => {
    // Replaces the old "drop a file on a directory row" test, which drove a
    // path that no longer exists: an attachment belongs to ONE folio now, so
    // the tree neither shows nor accepts them. That test asserted the bytes
    // landed in a particular DIRECTORY — a question the model can no longer
    // even ask.
    const url = await createFolio(`Attach-${stamp}`.slice(0, 24));
    await page.goto(url);
    // `createFolio` here passes no body, so the folio is empty and opens in
    // Edit mode — this only needs the document to be mounted before the
    // inspector is driven.
    await expect(page.locator('[data-slot="folio-document"]')).toBeVisible({
      timeout: 20_000,
    });

    // The inspector's fourth tab owns attachments now.
    await page.getByRole("tab", { name: /^files$/i }).click();
    await expect(page.getByText(/no files attached yet/i)).toBeVisible();

    const fileName = `attached-${stamp}.txt`;
    const registered = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith("/folio/blobs") &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20_000 },
    );
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("hello attachment"),
    });
    await registered;

    // It shows in the panel, and the folio's own list is what the server
    // agrees it belongs to.
    await expect(page.getByText(fileName)).toBeVisible({ timeout: 15_000 });

    const folioShortId = Number(url.split("/").pop());
    const names = await page.evaluate(
      async ({ pid, shortId }) => {
        const folioRes = await fetch(`/api/projects/${pid}/folios/${shortId}`, {
          credentials: "include",
        });
        const folio = (await folioRes.json()) as { id: string };
        const blobsRes = await fetch(`/api/folios/${folio.id}/blobs`, {
          credentials: "include",
        });
        return ((await blobsRes.json()) as Array<{ name: string }>).map(
          (b) => b.name,
        );
      },
      { pid: projectId, shortId: folioShortId },
    );
    expect(names).toEqual([fileName]);

    // And it is NOT a row in the tree — the whole point of the move.
    await expect(
      page.locator('[data-slot="folio-tree-row"]', {
        hasText: new RegExp(`^${fileName}$`),
      }),
    ).toHaveCount(0);
  });

  test("12 — wiki-links resolve in the rendered body", async () => {
    // Two references in one body: one that resolves to the folio created in
    // `beforeAll`, one that resolves to nothing. Both have to render, and be
    // told apart.
    //
    // ⚠️ This asserts VIEW mode, and the behaviour changed with the editor.
    // Lexical decorated `[[Title]]` in place — the token kept its source
    // text and carried the target on `data-wiki-href`. There is no in-place
    // decoration now: View mode renders `rewriteFolioWikiLinks`'s output, so
    // a reference is an ordinary `<a href>` whose text is the RESOLVED
    // title. Edit mode shows the raw `[[Title]]` token, unstyled, because
    // that is what is stored.
    const hostUrl = await createFolio(
      `Refs-${stamp}`.slice(0, 24),
      `Points at [[${folioTitle}]] and at [[No Such Folio ${stamp}]].`,
    );
    await page.goto(hostUrl);

    const body = page.locator(".lore-md-view");
    await expect(body).toBeVisible({ timeout: 20_000 });

    const resolved = body.getByRole("link", { name: folioTitle });
    await expect(resolved).toHaveAttribute(
      "href",
      new RegExp(`^/${projectSlug}/folios/\\d+$`),
    );

    // An unresolved reference keeps the text the author typed, which is the
    // signal that it did not resolve.
    //
    // ⚠️ It no longer keeps its `lore-broken:` href, and that is a real
    // capability loss worth stating plainly. `rewriteFolioWikiLinks` still
    // EMITS `[label](lore-broken:folio-not-found)`, but View mode renders
    // through `MarkdownView`, and react-markdown's default `urlTransform`
    // allows only http/https/mailto/tel and relative URLs — a custom scheme
    // is stripped to `""`. The old editor decorated broken links itself, in
    // Lexical, and could style them and explain the reason on hover.
    //
    // Not "fixed" here on purpose: the options are to teach `@alepha/ui`
    // about a Lore-specific scheme (wrong layering, it is a shared package)
    // or to change the marker syntax (a reader-side change affecting quest
    // descriptions too). Either is its own decision. The quest reader has
    // always behaved this way, so this makes the two surfaces consistent
    // rather than introducing a new inconsistency.
    const brokenLink = body.getByRole("link", {
      name: `[[No Such Folio ${stamp}]]`,
    });
    await expect(brokenLink).toHaveCount(1);
    await expect(brokenLink).toHaveAttribute("href", "");

    await test.step("the [[ picker inserts a reference", async () => {
      // The picker lives in Edit mode now — it is a `@codemirror/autocomplete`
      // source, not a Lexical typeahead, so the editor has to be mounted
      // before anything can be typed into it.
      await page.keyboard.press("ControlOrMeta+e");
      const editor = page.locator(".lore-md-edit .cm-content");
      await expect(editor).toBeVisible({ timeout: 10_000 });
      await editor.click();

      // End of the document, then a fresh paragraph so the new token cannot
      // merge into the sentence the assertions above depend on.
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("[[Ward");

      // CodeMirror renders its completions as an `option`-role list.
      const option = page.getByRole("option", { name: folioTitle }).first();
      await expect(option).toBeVisible({ timeout: 10_000 });
      await option.click();

      // The picker only ever inserts plain `[[token]]` text — which is why
      // the assertion is on the DOCUMENT, not on any decoration. There is no
      // decoration anymore; the token is markdown like everything else.
      await expect(editor).toContainText(`[[${folioTitle}]]`, {
        timeout: 10_000,
      });
    });

    await test.step("the markdown round-trip keeps the brackets", async () => {
      // Autosave has already written this — see the note in test 01. The read
      // below goes straight to the API, so it has to happen after the write
      // rather than after a click that no longer exists. `waitForResponse`
      // cannot be armed here (the edit that triggered the save is in the
      // previous step), so poll the stored content instead of racing it.
      const shortId = Number(hostUrl.split("/").pop());
      await expect
        .poll(
          async () =>
            page.evaluate(
              async ({ pid, sid }) => {
                const r = await fetch(`/api/projects/${pid}/folios/${sid}`, {
                  credentials: "include",
                });
                const folio = (await r.json()) as { content?: string };
                return folio.content ?? "";
              },
              { pid: projectId, sid: shortId },
            ),
          { timeout: 15_000 },
        )
        .toContain("[[");

      const content = await page.evaluate(
        async ({ pid, sid }) => {
          const r = await fetch(`/api/projects/${pid}/folios/${sid}`, {
            credentials: "include",
          });
          const folio = (await r.json()) as { content?: string };
          return folio.content ?? "";
        },
        { pid: projectId, sid: shortId },
      );
      // Not `\[\[…\]\]`: MDXEditor escapes brackets on the way out and
      // `normalizeEditorMarkdown` repairs them. A regression there silently
      // drops the project's whole link graph on the next save.
      expect(content).toContain(`[[${folioTitle}]]`);
      expect(content).toContain(`[[No Such Folio ${stamp}]]`);
    });
  });

  /**
   * Regression guard for #170: the toolbar's block-type Select published to
   * `applyBlockType$`, an MDXEditor signal with no subscriber, so the control
   * had never worked for any of its five values.
   *
   * Asserts the SAVED MARKDOWN, never the trigger label. The read side was
   * healthy the whole time — the trigger showed "Heading 2" correctly while
   * changing nothing — so a test that checks the trigger passes against the
   * bug it is meant to catch.
   *
   * All five values, because they take three different paths:
   * `$createHeadingNode` for h1/h2/h3, `$createQuoteNode` for quote and
   * `$createParagraphNode` for paragraph. A heading-only test would stay green
   * with quote broken.
   */
  // ⚠️ DELETED: "13 — the block-type select converts the current block".
  //
  // It drove MDXEditor's `BlockTypeSelect` combobox and asserted that
  // choosing Heading 1/2/3 or Quote wrote the right markdown prefix. That
  // control is gone with the formatting toolbar, and there is no equivalent
  // to point the test at: in raw markdown the author types `# `, so nothing
  // sits between the keystroke and the stored string for a test to verify.
  //
  // The coverage IS lost, not relocated. What it protected — that a block
  // conversion could not silently write the wrong heading level — was a
  // property of the WYSIWYG serializer, and that serializer no longer runs.
});
