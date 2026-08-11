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
 * `/p/:projectId/folios/:shortId` that replaced the old split between a
 * read-only `FolioView` and a separate `/edit` route (deleted, not
 * redirected).
 *
 * Distinct from `folios.spec.ts`, which covers `FolioBrowser`, the
 * file-manager surface at `/p/:projectId/folios`. Everything here is
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
    return `/p/${projectId}/folios/${folio.shortId}`;
  };

  const inspector = () => page.locator('[data-slot="folio-inspector"]');

  let folioUrl = "";

  test.beforeAll(async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL });
    page = await ctx.newPage();
    await registerAndVerify(page, `ws-${stamp}@example.com`, "GoodPassw0rd");
    projectId = await createProjectViaWizard(page, `WS${stamp}`.slice(0, 20));
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

    await summary.fill(summaryText);
    await page.getByRole("button", { name: /^save$|^enregistrer$/i }).click();
    // Wait for the status line to flip to Saved before reloading —
    // navigating mid-request abandons the save and the assertion below
    // then measures the reload, not the write.
    await expect(page.getByText(/^saved /i).first()).toBeVisible({
      timeout: 15_000,
    });

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
    await expect(
      inspector()
        .getByRole("button", { name: /created|edited|créé|modifié/i })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
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
    await expect(page.getByLabel(/summary for agents/i)).toBeVisible({
      timeout: 15_000,
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

  test("09 — /folios opens with nothing selected", async () => {
    await page.goto(`/p/${projectId}/folios`);
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

  test("09b — the empty-state menubar keeps its shape, only its enablement changes", async () => {
    await page.goto(`/p/${projectId}/folios`);
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
      await expect(
        page.getByRole("menuitem", { name: /rich text/i }),
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
    await page.goto(`/p/${projectId}/folios`);
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
    await page.goto(`/p/${projectId}/folios`);
    await expect(page.locator('[data-slot="folio-tree"]')).toBeVisible({
      timeout: 15_000,
    });
    await page
      .getByRole("button", { name: /^new folio$/i })
      .first()
      .click();
    // The tree creates the row and navigates straight into it, ready to be
    // renamed — so the editor is mounted and the chrome is back.
    await page.waitForURL(new RegExp(`/p/${projectId}/folios/\\d+`), {
      timeout: 20_000,
    });
    await expect(
      page.getByRole("textbox", { name: /editable markdown/i }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/no folio open/i)).toHaveCount(0);
  });

  test("11 — dropping a file on a directory row uploads it there", async () => {
    // Its own directory rather than test 08's: every other test here leans on
    // shared state, and the one thing this test must be sure of is WHICH
    // directory the bytes landed in.
    const dropDirName = `Drop-${stamp}`.slice(0, 24);
    await page.goto(`/p/${projectId}/folios`);
    const created = await page.evaluate(
      async ({ pid, name }) => {
        const r = await fetch(`/api/projects/${pid}/folio/directories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name }),
        });
        return `${r.status} ${await r.text()}`;
      },
      { pid: projectId, name: dropDirName },
    );
    expect(created).toMatch(/^200/);
    await page.reload();
    const dirRow = page
      .locator('[data-slot="folio-tree-row"]', {
        hasText: new RegExp(`^${dropDirName}$`),
      })
      .first();
    await expect(dirRow).toBeVisible({ timeout: 15_000 });

    // A real OS file drop cannot be driven from Playwright — there is no
    // page-side source element to start it from. Dispatching the two events
    // with a hand-built `DataTransfer` carrying a `File` is the same thing
    // from the handlers' point of view: `types` says "Files" on `dragover`
    // and the bytes appear on `drop`, which is exactly the distinction the
    // row makes between an external drop and one of its own rows moving.
    const fileName = `dropped-${stamp}.txt`;
    const dataTransfer = await page.evaluateHandle((name) => {
      const dt = new DataTransfer();
      dt.items.add(
        new File(["hello dropped blob"], name, { type: "text/plain" }),
      );
      return dt;
    }, fileName);

    await dirRow.dispatchEvent("dragover", { dataTransfer });
    // The directory highlights while the drag hovers it — the whole point of
    // telling a file drop from a row drag is that the target is legible.
    await expect(dirRow).toHaveClass(/ring-primary/);

    const registered = page.waitForResponse(
      (r) =>
        /\/folio\/blobs$/.test(new URL(r.url()).pathname) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20_000 },
    );
    await dirRow.dispatchEvent("drop", { dataTransfer });
    await registered;

    // The row appears in the tree under the directory it was dropped on —
    // and the server agrees about which directory that is.
    await expect(
      page.locator('[data-slot="folio-tree-row"]', {
        hasText: new RegExp(`^${fileName}$`),
      }),
    ).toBeVisible({ timeout: 15_000 });

    const parentName = await page.evaluate(
      async ({ pid, name }) => {
        const [blobsRes, dirsRes] = await Promise.all([
          fetch(`/api/projects/${pid}/folio/blobs/all`, {
            credentials: "include",
          }),
          fetch(`/api/projects/${pid}/folio/directories`, {
            credentials: "include",
          }),
        ]);
        const blobs = (await blobsRes.json()) as Array<{
          name: string;
          directoryId?: string;
        }>;
        const dirs = (await dirsRes.json()) as Array<{
          id: string;
          name: string;
        }>;
        const blob = blobs.find((b) => b.name === name);
        return dirs.find((d) => d.id === blob?.directoryId)?.name ?? null;
      },
      { pid: projectId, name: fileName },
    );
    expect(parentName).toBe(dropDirName);
  });

  test("12 — wiki-links are live inside the editor body", async () => {
    // Two references in one body: one that resolves to the folio created in
    // `beforeAll`, one that resolves to nothing. Both have to be decorated,
    // and told apart.
    const hostUrl = await createFolio(
      `Refs-${stamp}`.slice(0, 24),
      `Points at [[${folioTitle}]] and at [[No Such Folio ${stamp}]].`,
    );
    await page.goto(hostUrl);

    const links = page.locator(".lore-mdx-content .lore-wikilink");
    await expect(links).toHaveCount(2, { timeout: 20_000 });

    // The token keeps its source text — that is the whole point of decorating
    // in place rather than swapping in a resolved title (#131).
    await expect(links.first()).toHaveText(`[[${folioTitle}]]`);
    // …and carries the resolved target, which is what the ⌘-click handler
    // and the hover card both read.
    await expect(links.first()).toHaveAttribute(
      "data-wiki-href",
      new RegExp(`^/p/${projectId}/folios/\\d+$`),
    );

    const brokenLink = page.locator(".lore-mdx-content .lore-wikilink-broken");
    await expect(brokenLink).toHaveCount(1);
    await expect(brokenLink).toHaveAttribute(
      "data-wiki-href",
      "lore-broken:folio-not-found",
    );

    await test.step("the [[ picker inserts a reference", async () => {
      const body = page.getByRole("textbox", { name: /editable markdown/i });
      await body.click();
      // End of the document, then a fresh paragraph so the new token cannot
      // merge into the sentence the assertions above depend on.
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.press("Enter");
      await page.keyboard.type("[[Ward");

      const option = page.getByRole("button", { name: folioTitle }).last();
      await expect(option).toBeVisible({ timeout: 10_000 });
      await option.click();

      // The picker only ever inserts plain `[[token]]` text — the same text
      // entity that handles hand-typing is what turns it into a live token,
      // so a third decorated link is the proof both paths converge.
      await expect(links).toHaveCount(3, { timeout: 10_000 });
    });

    await test.step("the markdown round-trip keeps the brackets", async () => {
      await page.getByRole("button", { name: /^save$|^enregistrer$/i }).click();
      await expect(page.getByText(/^saved /i).first()).toBeVisible({
        timeout: 15_000,
      });

      const shortId = Number(hostUrl.split("/").pop());
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
  test("13 — the block-type select converts the current block", async () => {
    const cases: { value: RegExp; expect: string }[] = [
      { value: /heading 1/i, expect: "# " },
      { value: /heading 2/i, expect: "## " },
      { value: /heading 3/i, expect: "### " },
      { value: /quote/i, expect: "> " },
    ];

    for (const item of cases) {
      const url = await createFolio(
        `Block-${item.expect.trim().length}-${stamp}`.slice(0, 24),
        "Convert me",
      );
      await page.goto(url);

      const body = page.getByRole("textbox", { name: /editable markdown/i });
      await expect(body).toBeVisible({ timeout: 20_000 });
      // The TEXT, not the box. MDXEditor keeps a trailing empty paragraph, so
      // clicking the container's centre drops the caret in THAT — and the
      // select then reports the trailing paragraph's type rather than the
      // block under test.
      await body.getByText("Convert me").click();

      await page
        .getByRole("combobox", { name: /block type|type de bloc/i })
        .click();
      await page.getByRole("option", { name: item.value }).click();

      await page.getByRole("button", { name: /^save$|^enregistrer$/i }).click();
      await expect(page.getByText(/^saved /i).first()).toBeVisible({
        timeout: 15_000,
      });

      const shortId = Number(url.split("/").pop());
      const content = await page.evaluate(
        async ({ pid, sid }) => {
          const r = await fetch(`/api/projects/${pid}/folios/${sid}`, {
            credentials: "include",
          });
          return ((await r.json()) as { content?: string }).content ?? "";
        },
        { pid: projectId, sid: shortId },
      );
      // ANCHORED, not `toContain`. Every heading marker is a prefix of the
      // next one, so `"### Convert me"` contains `"# Convert me"` AND
      // `"## Convert me"` — a regression that converted everything to h3
      // would satisfy all three heading cases of this loop. `startsWith`
      // after `trimStart` is what makes the levels distinguishable.
      expect(content.trimStart().startsWith(`${item.expect}Convert me`)).toBe(
        true,
      );
    }

    // Paragraph is the round trip, and the one value with no marker of its
    // own: converting away from a heading has to leave plain text behind.
    const url = await createFolio(
      `Block-para-${stamp}`.slice(0, 24),
      "## Convert me back",
    );
    await page.goto(url);
    const body = page.getByRole("textbox", { name: /editable markdown/i });
    await expect(body).toBeVisible({ timeout: 20_000 });
    // Specifically the heading. Clicking the container centre would land in
    // the trailing empty paragraph, where the control already reads
    // "Paragraph" — selecting it fires no change event, nothing converts, and
    // this test hangs on a Save button that never enables. That is exactly how
    // it failed the first time it ran.
    await body.locator("h2").click();
    await page
      .getByRole("combobox", { name: /block type|type de bloc/i })
      .click();
    await page
      .getByRole("option", { name: /^paragraph$|^paragraphe$/i })
      .click();
    await page.getByRole("button", { name: /^save$|^enregistrer$/i }).click();
    await expect(page.getByText(/^saved /i).first()).toBeVisible({
      timeout: 15_000,
    });

    const shortId = Number(url.split("/").pop());
    const content = await page.evaluate(
      async ({ pid, sid }) => {
        const r = await fetch(`/api/projects/${pid}/folios/${sid}`, {
          credentials: "include",
        });
        return ((await r.json()) as { content?: string }).content ?? "";
      },
      { pid: projectId, sid: shortId },
    );
    // Anchored for the same reason as the loop above, and here it is the only
    // assertion that means anything: `not.toContain("## Convert me back")` is
    // satisfied by `"# Convert me back"`, so an h2 that converted to h1
    // instead of to a paragraph would have passed. "Paragraph" means no
    // marker at all, which is exactly what `startsWith` on the text says.
    expect(content.trimStart().startsWith("Convert me back")).toBe(true);
  });
});
