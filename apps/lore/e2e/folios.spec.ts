import * as fs from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
  createProjectViaWizard,
  emailDir,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * Comprehensive Folio feature suite.
 *
 * One serial spec — register once, create one project, then exercise
 * every Folio feature on the same page. Order matters: later tests
 * rely on artifacts created by earlier ones (e.g. the move test moves
 * the folio created by the create-folio test).
 *
 * Coverage:
 *  - create folio (via Create dropdown → New folio)
 *  - create directory (via Create dropdown → New directory)
 *  - rename folio (row actions)
 *  - pin folio (row actions)
 *  - search filters the listing
 *  - sort by Name header (asc → desc → none cycle)
 *  - view toggle (list ↔ grid)
 *  - enter directory + AppShell breadcrumb returns to root
 *  - move folio into a directory (single-row move dialog)
 *  - upload a small text blob (Create dropdown → Upload)
 *  - bulk delete (multi-select chip → delete)
 */

test.describe.configure({ mode: "serial" });

test.describe("Folio — comprehensive feature suite", () => {
  test.setTimeout(180_000);

  test.beforeAll(() => {
    fs.mkdirSync(emailDir, { recursive: true });
  });

  let page: Page;
  let projectId: number;
  const stamp = Date.now();
  const folioName = `Notes-${stamp}`.slice(0, 24);
  const folioRenamed = `Renamed-${stamp}`.slice(0, 24);
  const dirName = `Box-${stamp}`.slice(0, 24);
  const blobName = `note-${stamp}.txt`;
  const bulkDoomedA = `DoomA-${stamp}`.slice(0, 24);
  const bulkDoomedB = `DoomB-${stamp}`.slice(0, 24);
  const nest1Name = `N1-${stamp}`.slice(0, 24);
  const nest2Name = `N2-${stamp}`.slice(0, 24);
  const nest3Name = `N3-${stamp}`.slice(0, 24);

  const folioUrl = () => `/p/${projectId}/folios`;

  /**
   * Navigate the shared page back to the Folio root. Most tests need
   * a clean starting point (no `?dir=`, no stale search query).
   */
  const goToFolio = async () => {
    await page.goto(folioUrl());
    await page.waitForLoadState("domcontentloaded");
    await expect(
      page.getByRole("button", { name: /^create$/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  };

  /**
   * Open the row actions menu for the entry with the given accessible
   * name. The MoreHorizontal button on each row has no label, so we
   * navigate by row container.
   */
  const openRowActions = async (rowName: string) => {
    const row = page
      .locator("tr", { has: page.getByText(rowName, { exact: true }) })
      .first();
    await row.getByRole("button").last().click();
  };

  test.beforeAll(async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL });
    page = await ctx.newPage();
    const email = `arc-${stamp}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");
    const projectTitle = `Arc${stamp}`.slice(0, 20);
    projectId = await createProjectViaWizard(page, projectTitle);
    await goToFolio();
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test("01 — create folio via Create dropdown", async () => {
    await goToFolio();
    await page.getByRole("button", { name: /^create$/i }).click();
    await page
      .getByRole("menuitem", { name: /^new folio$/i })
      .first()
      .click();
    await page.waitForURL(/\/folios\/new/, { timeout: 10_000 });
    await page.getByPlaceholder(/^untitled$|^sans titre$/i).fill(folioName);
    await page.getByRole("button", { name: /^save$|^enregistrer$/i }).click();
    await page.waitForURL(new RegExp(`/p/${projectId}/folios/\\d+`), {
      timeout: 15_000,
    });
    await goToFolio();
    await expect(page.getByText(folioName, { exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("02 — create directory via Create dropdown", async () => {
    await goToFolio();
    await page.getByRole("button", { name: /^create$/i }).click();
    await page
      .getByRole("menuitem", { name: /^new directory$|nouveau dossier/i })
      .first()
      .click();
    // dialog.prompt renders a Dialog with an Input + confirm.
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
  });

  test("03 — rename folio via row actions", async () => {
    await goToFolio();
    await openRowActions(folioName);
    await page
      .getByRole("menuitem", { name: /^rename$|^renommer$/i })
      .first()
      .click();
    const dialog = page
      .locator('[role="dialog"], [role="alertdialog"]')
      .first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    const input = dialog.getByRole("textbox").first();
    await input.fill(folioRenamed);
    await dialog
      .getByRole("button", { name: /^ok$|^confirm$|^valider$|^rename$/i })
      .first()
      .click();
    await expect(page.getByText(folioRenamed, { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(folioName, { exact: true })).toHaveCount(0);
  });

  test("04 — pin folio via row actions", async () => {
    await goToFolio();
    await openRowActions(folioRenamed);
    await page
      .getByRole("menuitem", { name: /^pin$|^épingler$/i })
      .first()
      .click();
    // Pin shows as an inline Pin icon next to the name; re-open the
    // actions menu and assert Unpin is the available action now.
    await openRowActions(folioRenamed);
    await expect(
      page.getByRole("menuitem", { name: /^unpin$|désépingler/i }),
    ).toBeVisible({ timeout: 5_000 });
    // Dismiss the menu.
    await page.keyboard.press("Escape");
  });

  test("05 — search filters the listing then clears", async () => {
    await goToFolio();
    const searchBox = page.getByPlaceholder(/search in folio|rechercher/i);
    await searchBox.fill(folioRenamed);
    await expect(page.getByText(folioRenamed, { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(dirName, { exact: true })).toHaveCount(0);
    // Clear via the X button.
    await page
      .getByRole("button", { name: /clear selection|effacer la sélection/i })
      .first()
      .click();
    await expect(page.getByText(dirName, { exact: true })).toBeVisible({
      timeout: 5_000,
    });
  });

  test("06 — sort by Name header cycles asc → desc → none", async () => {
    await goToFolio();
    // Header is a <button> inside the table's <thead>. Sort label is
    // its aria-label ("Sort"/"Trier") since the visible text mixes the
    // column name + arrow indicator.
    // Locator must survive the click adding "↑"/"↓" to the button's
    // visible text — use a partial-match regex so "Name ↑" still hits.
    const nameHeader = page
      .locator("thead button")
      .filter({ hasText: /name|nom/i })
      .first();
    await expect(nameHeader).toBeVisible({ timeout: 5_000 });
    // Click 1: asc — arrow indicator appears inside the button.
    await nameHeader.click();
    await expect(nameHeader).toContainText("↑", { timeout: 3_000 });
    // Click 2: desc.
    await nameHeader.click();
    await expect(nameHeader).toContainText("↓", { timeout: 3_000 });
    // Click 3: back to none — no arrow.
    await nameHeader.click();
    await expect(nameHeader).not.toContainText(/↑|↓/, { timeout: 3_000 });
  });

  test("07 — view toggle list ↔ grid", async () => {
    await goToFolio();
    // In list view: a <table> is rendered.
    await expect(page.locator("table")).toBeVisible({ timeout: 5_000 });
    // Segmented control renders options as role="radio".
    await page.getByRole("radio", { name: /grid|grille/i }).click();
    // In grid view: no table.
    await expect(page.locator("table")).toHaveCount(0);
    await page.getByRole("radio", { name: /list|liste/i }).click();
    await expect(page.locator("table")).toBeVisible({ timeout: 5_000 });
  });

  test("08 — enter directory + breadcrumb returns to root", async () => {
    await goToFolio();
    await page.getByText(dirName, { exact: true }).click();
    await page.waitForURL(/\?dir=\d+/, { timeout: 10_000 });
    // AppShell breadcrumb now includes the directory name. The section
    // crumb reads "Folios" (plural — `project.menu.folios`, the same
    // label the sidebar link uses since the great rename folded Archive
    // into Folios); it was never singular "Folio", so the OR here is
    // just defensive against a future label tweak.
    await expect(
      page
        .getByRole("link", { name: /^folio$/i })
        .or(page.getByRole("link", { name: /^folios$/i }))
        .first(),
    ).toBeVisible({ timeout: 5_000 });
    // Click the Folios crumb to climb back to the root.
    await page
      .getByRole("link", { name: /^folio$/i })
      .or(page.getByRole("link", { name: /^folios$/i }))
      .first()
      .click();
    await page.waitForURL(new RegExp(`${folioUrl()}$`), { timeout: 10_000 });
  });

  test("09 — move folio into directory via row actions", async () => {
    await goToFolio();
    await openRowActions(folioRenamed);
    await page
      .getByRole("menuitem", { name: /^move$|^déplacer$/i })
      .first()
      .click();
    const dialog = page
      .locator('[role="dialog"], [role="alertdialog"]')
      .first();
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // Pick the directory in the tree.
    await dialog.getByText(dirName, { exact: true }).click();
    await dialog
      .getByRole("button", { name: /move here|déplacer ici/i })
      .click();
    // Back at folio root — folio is gone (it's now inside the dir).
    await expect(page.getByText(folioRenamed, { exact: true })).toHaveCount(0, {
      timeout: 10_000,
    });
    // Drill into the directory and assert the folio is there.
    await page.getByText(dirName, { exact: true }).click();
    await page.waitForURL(/\?dir=\d+/, { timeout: 10_000 });
    await expect(page.getByText(folioRenamed, { exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("10 — upload a small text blob", async () => {
    await goToFolio();
    // Trigger the hidden <input type=file> via the Upload menu item.
    // Wait for both halves of the two-step upload: framework
    // /api/files POST then the Lore-side blob register.
    const filesPostPromise = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && /\/api\/files(\?|$)/.test(r.url()),
      { timeout: 20_000 },
    );
    const registerPromise = page.waitForResponse(
      (r) => r.request().method() === "POST" && /\/folio\/blobs/.test(r.url()),
      { timeout: 20_000 },
    );
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: /^create$/i }).click();
    await page
      .getByRole("menuitem", { name: /upload files|téléverser/i })
      .first()
      .click();
    const chooser = await fileChooserPromise;
    await chooser.setFiles({
      name: blobName,
      mimeType: "text/plain",
      buffer: Buffer.from(`hello from ${stamp}`),
    });
    const filesResp = await filesPostPromise;
    if (!filesResp.ok()) {
      const body = await filesResp.text().catch(() => "<unreadable>");
      throw new Error(
        `framework upload ${filesResp.status()} — ${body.slice(0, 400)}`,
      );
    }
    const registerResp = await registerPromise;
    if (!registerResp.ok()) {
      const body = await registerResp.text().catch(() => "<unreadable>");
      throw new Error(
        `register blob ${registerResp.status()} — ${body.slice(0, 400)}`,
      );
    }
    await expect(page.getByText(blobName, { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("11 — bulk delete two folios", async () => {
    await goToFolio();
    // Seed two doomed folios via the existing create flow — keeps the
    // test self-contained (delete happens to these two, not to any
    // earlier artifact).
    for (const name of [bulkDoomedA, bulkDoomedB]) {
      await page.getByRole("button", { name: /^create$/i }).click();
      await page
        .getByRole("menuitem", { name: /^new folio$/i })
        .first()
        .click();
      await page.waitForURL(/\/folios\/new/, { timeout: 10_000 });
      await page.getByPlaceholder(/^untitled$|^sans titre$/i).fill(name);
      await page.getByRole("button", { name: /^save$|^enregistrer$/i }).click();
      await page.waitForURL(new RegExp(`/p/${projectId}/folios/\\d+`), {
        timeout: 15_000,
      });
      await goToFolio();
      await expect(page.getByText(name, { exact: true })).toBeVisible({
        timeout: 10_000,
      });
    }

    // Check both rows.
    for (const name of [bulkDoomedA, bulkDoomedB]) {
      const row = page
        .locator("tr", { has: page.getByText(name, { exact: true }) })
        .first();
      await row.getByRole("checkbox").click();
    }

    // Bulk chip with "Delete" appears.
    const trashBtn = page
      .getByRole("button", { name: /delete|supprimer/i })
      .first();
    await trashBtn.click();
    const confirm = page
      .locator('[role="dialog"], [role="alertdialog"]')
      .first();
    await expect(confirm).toBeVisible({ timeout: 5_000 });
    await confirm
      .getByRole("button", { name: /^delete$|^supprimer$|^confirm$|^ok$/i })
      .first()
      .click();

    await expect(page.getByText(bulkDoomedA, { exact: true })).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(page.getByText(bulkDoomedB, { exact: true })).toHaveCount(0);
  });

  test("12 — nested dirs: breadcrumb tracks depth + breadcrumb nav + reload", async () => {
    // Helper: create a directory in the current view via Create dropdown.
    const createDirHere = async (name: string) => {
      await page.getByRole("button", { name: /^create$/i }).click();
      await page
        .getByRole("menuitem", { name: /^new directory$|nouveau dossier/i })
        .first()
        .click();
      const dlg = page.locator('[role="dialog"], [role="alertdialog"]').first();
      await expect(dlg).toBeVisible({ timeout: 5_000 });
      await dlg.getByRole("textbox").first().fill(name);
      await dlg
        .getByRole("button", { name: /^ok$|^confirm$|^valider$|^create$/i })
        .first()
        .click();
      await expect(page.getByText(name, { exact: true })).toBeVisible({
        timeout: 10_000,
      });
    };

    // Helper: the AppShell breadcrumb is a <nav aria-label="breadcrumb">
    // with a list of links. The current location's segment renders as
    // a disabled link with the same text.
    const breadcrumb = () =>
      page.getByRole("navigation", { name: /breadcrumb/i });
    const expectBreadcrumbHas = async (segments: string[]) => {
      for (const seg of segments) {
        await expect(
          breadcrumb().getByRole("link", { name: new RegExp(`^${seg}$`, "i") }),
        ).toBeVisible({ timeout: 5_000 });
      }
    };

    await goToFolio();

    // --- depth 1 -----------------------------------------------------
    await createDirHere(nest1Name);
    await page.getByText(nest1Name, { exact: true }).click();
    await page.waitForURL(/\?dir=\d+/, { timeout: 10_000 });
    await expectBreadcrumbHas(["folios", nest1Name]);

    // --- depth 2 -----------------------------------------------------
    await createDirHere(nest2Name);
    await page.getByText(nest2Name, { exact: true }).click();
    await page.waitForURL(/\?dir=\d+/, { timeout: 10_000 });
    await expectBreadcrumbHas(["folios", nest1Name, nest2Name]);

    // --- depth 3 -----------------------------------------------------
    await createDirHere(nest3Name);
    await page.getByText(nest3Name, { exact: true }).click();
    await page.waitForURL(/\?dir=\d+/, { timeout: 10_000 });
    await expectBreadcrumbHas(["folios", nest1Name, nest2Name, nest3Name]);

    // --- reload at depth 3 — breadcrumb survives via the ?dir URL ----
    const deepUrl = page.url();
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).toBe(deepUrl);
    await expectBreadcrumbHas(["folios", nest1Name, nest2Name, nest3Name]);

    // --- breadcrumb-nav up to depth 2 (click nest2) ------------------
    // The current segment renders as a disabled link; the navigable
    // ancestor (nest2 from depth 3) is an enabled link in the
    // breadcrumb.
    await breadcrumb()
      .getByRole("link", { name: new RegExp(`^${nest2Name}$`, "i") })
      .click();
    await page.waitForURL(/\?dir=\d+/, { timeout: 10_000 });
    await expectBreadcrumbHas(["folios", nest1Name, nest2Name]);
    // Listing at nest2 should show nest3 (its child).
    await expect(page.getByText(nest3Name, { exact: true })).toBeVisible({
      timeout: 5_000,
    });

    // --- breadcrumb-nav back to root via "Folios" link -------------
    await breadcrumb()
      .getByRole("link", { name: /^folios$/i })
      .click();
    await page.waitForURL(new RegExp(`${folioUrl()}$`), { timeout: 10_000 });
    // Root listing should still have nest1 (top-level) but not nest2/3.
    await expect(page.getByText(nest1Name, { exact: true })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(nest2Name, { exact: true })).toHaveCount(0);
    await expect(page.getByText(nest3Name, { exact: true })).toHaveCount(0);

    // --- reload at root ---------------------------------------------
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByText(nest1Name, { exact: true })).toBeVisible({
      timeout: 5_000,
    });
  });

  test("13 — folio inside deep dir + breadcrumb back to that dir", async () => {
    // Walk back down to nest3 (created in test 12). After each click,
    // wait for the NEXT-level child row to appear before clicking
    // again — `waitForURL(/\?dir=\d+/)` matches the prior URL too soon.
    const breadcrumb = page.getByRole("navigation", { name: /breadcrumb/i });
    const inDir = async (name: string) => {
      await expect(
        breadcrumb.getByRole("link", { name: new RegExp(`^${name}$`, "i") }),
      ).toBeVisible({ timeout: 10_000 });
    };
    await goToFolio();
    await page.getByText(nest1Name, { exact: true }).click();
    await inDir(nest1Name);
    await expect(page.getByText(nest2Name, { exact: true })).toBeVisible();
    await page.getByText(nest2Name, { exact: true }).click();
    await inDir(nest2Name);
    await expect(page.getByText(nest3Name, { exact: true })).toBeVisible();
    await page.getByText(nest3Name, { exact: true }).click();
    await inDir(nest3Name);

    // Remember nest3's URL so we can assert the breadcrumb-back trip
    // lands us right back here.
    const nest3Url = page.url();

    // Create a folio inside nest3.
    const deepFolioName = `Deep-${stamp}`.slice(0, 24);
    await page.getByRole("button", { name: /^create$/i }).click();
    await page
      .getByRole("menuitem", { name: /^new folio$/i })
      .first()
      .click();
    await page.waitForURL(/\/folios\/new/, { timeout: 10_000 });
    await page.getByPlaceholder(/^untitled$|^sans titre$/i).fill(deepFolioName);
    await page.getByRole("button", { name: /^save$|^enregistrer$/i }).click();
    // Saved → folio detail URL.
    await page.waitForURL(new RegExp(`/p/${projectId}/folios/\\d+$`), {
      timeout: 15_000,
    });

    // While viewing the folio, the breadcrumb should carry the full
    // directory chain + the folio title leaf.
    await expect(
      breadcrumb.getByRole("link", {
        name: new RegExp(`^${nest1Name}$`, "i"),
      }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      breadcrumb.getByRole("link", {
        name: new RegExp(`^${nest2Name}$`, "i"),
      }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      breadcrumb.getByRole("link", {
        name: new RegExp(`^${nest3Name}$`, "i"),
      }),
    ).toBeVisible({ timeout: 5_000 });

    // Click the nest3 breadcrumb link — expect to land back in nest3.
    await breadcrumb
      .getByRole("link", { name: new RegExp(`^${nest3Name}$`, "i") })
      .click();

    // The URL should be back to nest3's `?dir=<shortId>`.
    await page.waitForURL(/\?dir=\d+/, { timeout: 10_000 });
    expect(page.url()).toBe(nest3Url);

    // The new folio we just created inside nest3 should be in the
    // listing — that's the refresh the user expects on breadcrumb nav.
    await expect(page.getByText(deepFolioName, { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Breadcrumb should now show Folio > nest1 > nest2 > nest3 —
    // no leftover folio-title leaf.
    await expect(
      breadcrumb.getByRole("link", {
        name: new RegExp(`^${nest3Name}$`, "i"),
      }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(breadcrumb.getByText(deepFolioName)).toHaveCount(0);
  });

  test("14 — right-click row opens context menu with Rename / Move / Delete", async () => {
    await goToFolio();
    // blobName lives at root from test 10 and survives subsequent tests.
    const row = page
      .locator("tr", { has: page.getByText(blobName, { exact: true }) })
      .first();
    await row.click({ button: "right" });
    // Radix ContextMenu renders items with role=menuitem.
    await expect(
      page.getByRole("menuitem", { name: /^rename$|^renommer$/i }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("menuitem", { name: /^move$|^déplacer$/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /^delete$|^supprimer$/i }),
    ).toBeVisible();
    // Close menu so it doesn't leak into subsequent tests.
    await page.keyboard.press("Escape");
  });

  test("15b — Recent activity panel opens, shows entries, persists across reloads", async () => {
    await goToFolio();
    // Open the panel via the collapsed-rail History button.
    await page
      .getByRole("button", { name: /open activity panel|panneau d'activité/i })
      .first()
      .click();
    // Panel title appears.
    await expect(
      page.getByText(/^recent activity$|^activité récente$/i),
    ).toBeVisible({ timeout: 10_000 });
    // At least one row referencing an entity created earlier. By 15b
    // the original folioName has been renamed (test 03) so the feed
    // shows folioRenamed.
    await expect(
      page.getByRole("complementary").getByText(folioRenamed).first(),
    ).toBeVisible({ timeout: 10_000 });
    // Reload — open state should persist.
    await goToFolio();
    await expect(
      page.getByText(/^recent activity$|^activité récente$/i),
    ).toBeVisible({ timeout: 5_000 });
    // Close it so subsequent tests don't see a narrower table.
    await page
      .getByRole("button", { name: /close activity panel|fermer le panneau/i })
      .first()
      .click();
  });

  test("15 — drag a blob onto a directory moves it in", async () => {
    // Reuse the existing root-level pieces: blobName (created in test 10)
    // and dirName (created in test 2, already holds folioRenamed from
    // test 9). Drag the blob into the existing dir to avoid the noise
    // of creating fresh fixtures inside this single test.
    await goToFolio();

    const blobRow = page
      .locator("tr", { has: page.getByText(blobName, { exact: true }) })
      .first();
    const dirRow = page
      .locator("tr", { has: page.getByText(dirName, { exact: true }) })
      .first();
    await expect(blobRow).toBeVisible({ timeout: 10_000 });
    await expect(dirRow).toBeVisible({ timeout: 10_000 });

    const blobBox = await blobRow.boundingBox();
    const dirBox = await dirRow.boundingBox();
    if (!blobBox || !dirBox) {
      throw new Error("drag/drop bounding boxes missing");
    }

    // dnd-kit's PointerSensor uses a 6px activation distance — move past
    // it before sliding onto the target, so the drag actually starts.
    await page.mouse.move(
      blobBox.x + blobBox.width / 2,
      blobBox.y + blobBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      blobBox.x + blobBox.width / 2 + 20,
      blobBox.y + blobBox.height / 2 + 20,
      { steps: 5 },
    );
    await page.mouse.move(
      dirBox.x + dirBox.width / 2,
      dirBox.y + dirBox.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();

    // After the move the blob disappears from root.
    await expect(page.getByText(blobName, { exact: true })).toHaveCount(0, {
      timeout: 10_000,
    });

    // And appears inside the directory.
    await page.getByText(dirName, { exact: true }).click();
    await page.waitForURL(/\?dir=\d+/, { timeout: 10_000 });
    await expect(page.getByText(blobName, { exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });
});
