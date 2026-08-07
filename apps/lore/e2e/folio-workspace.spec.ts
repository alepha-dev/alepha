import * as fs from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  apiPost,
  createProjectViaWizard,
  emailDir,
  registerAndVerify,
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
    // A directory to drop into, created from the browser surface.
    await page.goto(`/p/${projectId}/folios`);
    await page
      .getByRole("button", { name: /^create$/i })
      .first()
      .click();
    await page
      .getByRole("menuitem", { name: /^new directory$|nouveau dossier/i })
      .first()
      .click();
    const dialog = page
      .locator('[role="dialog"], [role="alertdialog"]')
      .first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.getByRole("textbox").first().fill(dirName);
    await dialog
      .getByRole("button", { name: /^ok$|^confirm$|^valider$|^create$/i })
      .first()
      .click();
    await expect(page.getByText(dirName, { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    await page.goto(folioUrl);
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

    await page.goto(`/p/${projectId}/folios`);
    await page.waitForLoadState("networkidle");
    // Gone from the root listing…
    await expect(page.getByText(folioTitle, { exact: true })).toHaveCount(0, {
      timeout: 15_000,
    });
    // …and inside the directory.
    await page.getByText(dirName, { exact: true }).click();
    await page.waitForURL(/\?dir=\d+/, { timeout: 10_000 });
    await expect(page.getByText(folioTitle, { exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });
});
