import { expect, test } from "@playwright/test";
import {
  createProjectViaWizard,
  fillMarkdownEditor,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * Protected folios (Lore quest #50) — end-to-end encrypted folios. As of
 * the encryption-UX rework, encryption is no longer chosen at create time;
 * a clear folio is encrypted from the workspace's Folio▸Encrypt action,
 * and a locked folio is opened through the locked panel's own Unlock
 * button — both inside the one always-editable workspace that replaced the
 * read-only view and its Clear ⇄ Encrypted toggle. The core contracts
 * under test are unchanged by that move:
 *
 *  1. Encrypt-from-view: a clear folio encrypted with a passphrase
 *     persists ciphertext server-side. The server payload for that
 *     folio's `content` is a JSON envelope, never plaintext.
 *  2. Wrong passphrase rejection: the unlock dialog surfaces a generic
 *     "Wrong passphrase" error and DOESN'T leak the plaintext.
 *  3. Right passphrase round-trip: the same passphrase reveals the
 *     original markdown body, including a marker we put in to make
 *     accidental plaintext leakage detectable.
 *
 * Crypto runs in the browser via `BrowserCryptoProvider`. We don't mock
 * Web Crypto — Playwright's Chromium has it natively. The PBKDF2 600k
 * iterations is slow (~1s on Chromium), so test timeouts are bumped.
 */
test.describe("Protected folio", () => {
  test("encrypt from view → fail with wrong passphrase → unlock with right one", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    const email = `pfolio${t}@example.com`;
    const password = "PFolioTest123!";
    const projectTitle = `PF${t}`.slice(0, 20);
    const passphrase = "correct horse battery staple";
    const wrongPassphrase = "wrong donkey panini sample";
    // The folio is identified by its shortId, read off the URL after save.
    // It used to be found by a title typed into the document, but the folio
    // heading is gone — a folio is named in the TREE now — so every folio
    // created this way is "Untitled" and a title lookup would match whichever
    // one came back first.
    let folioShortId = 0;
    // Distinctive plaintext marker — used to verify both round-trip
    // success AND ciphertext-never-on-wire (the marker must NOT appear
    // in the server response for the folio's content).
    const folioBody = `LOOTBAG-${t} — known-good marker for round-trip assertion`;

    await registerAndVerify(page, email, password);
    const { id: projectId, slug: projectSlug } = await createProjectViaWizard(
      page,
      projectTitle,
    );

    await test.step("create a clear folio via the editor", async () => {
      // Navigate via SPA — direct `page.goto('/folios/new')` from the
      // landing page lands on the project root for reasons that look
      // like an SSR/hydration race. Going through the Folios link is
      // closer to the user flow anyway.
      await page
        .getByRole("link", { name: /^folios$/i })
        .first()
        .click();
      await page.waitForURL(new RegExp(`/${projectSlug}/folios`), {
        timeout: 15_000,
      });
      // `/folios` opens the workspace with nothing selected — the directory
      // table and its Create dropdown are gone, so a new folio starts from
      // the tree pane's own New folio button.
      await page
        .getByRole("button", { name: /^new folio$/i })
        .first()
        .click();
      // The create surface IS the workspace, and the document heading is
      // gone with it — so the BODY placeholder is what says the editor is
      // ready. The title field's placeholder used to serve this and no
      // longer exists.
      await expect(page.getByText(/start writing markdown/i)).toBeVisible({
        timeout: 15_000,
      });

      // ⚠️ No Save click. The tree's "New folio" button creates a REAL folio
      // through the API and navigates to it, so by the time the editor is up
      // this is an EXISTING folio — `useFolioAutoSave` covers it, and the
      // button (which survives only in create mode, at /folios/new) is not
      // rendered. Armed before the edit that triggers the write.
      await page.waitForURL(new RegExp(`/${projectSlug}/folios/\\d+`), {
        timeout: 30_000,
      });
      const saved = page.waitForResponse(
        (r) => /\/api\/update\//.test(r.url()) && r.status() === 200,
        { timeout: 30_000 },
      );
      await fillMarkdownEditor(page, folioBody);
      await saved;

      folioShortId = Number(new URL(page.url()).pathname.split("/").pop());
      expect(folioShortId).toBeGreaterThan(0);
    });

    await test.step("encrypt the folio from its view", async () => {
      // Encrypt lives in the workspace menubar's Folio menu now — the
      // header "…" (More actions) dropdown went away with `FolioView`.
      await page
        .locator('[data-slot="menubar-trigger"]', { hasText: /^Folio$/ })
        .first()
        .click();
      await page
        .getByRole("menuitem", { name: /^encrypt/i })
        .first()
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await dialog.getByLabel(/^passphrase$/i).fill(passphrase);
      await dialog.getByLabel(/confirm passphrase/i).fill(passphrase);
      await dialog.getByRole("button", { name: /^encrypt$/i }).click();
      // After encryption the folio is protected AND unlocked (key cached),
      // so the body still shows the marker and the toggle reads "Clear".
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      await expect(page.getByText(`LOOTBAG-${t}`).first()).toBeVisible({
        timeout: 30_000,
      });
    });

    await test.step("server-stored content is an envelope, never plaintext", async () => {
      // Hit the same list endpoint the layout loader uses; assert the
      // freshly-encrypted folio's content shape.
      const folios = (await page.evaluate(async (cid) => {
        const r = await fetch(`/api/list?projectId=${cid}&limit=100`, {
          credentials: "include",
        });
        if (!r.ok) throw new Error(`list: ${r.status}`);
        return (await r.json()) as Array<{
          shortId: number;
          protected: boolean;
          content: string;
        }>;
      }, projectId)) as Array<{
        shortId: number;
        protected: boolean;
        content: string;
      }>;

      const folio = folios.find((f) => f.shortId === folioShortId);
      expect(folio).toBeDefined();
      expect(folio!.protected).toBe(true);
      // Envelope shape: JSON with salt/iv/ciphertext/kdf.
      const parsed = JSON.parse(folio!.content) as Record<string, unknown>;
      expect(parsed).toHaveProperty("salt");
      expect(parsed).toHaveProperty("iv");
      expect(parsed).toHaveProperty("ciphertext");
      // Critical: the plaintext marker MUST NOT appear in the stored
      // content. If it does, encryption silently fell back somewhere.
      expect(folio!.content).not.toContain(`LOOTBAG-${t}`);
    });

    await test.step("page reloads into the locked state (key not cached)", async () => {
      await page.reload();
      await page.waitForLoadState("networkidle");
      // The workspace shows `FolioLockedPanel` in place of the document
      // body — the old read-only `FolioProtectedView` and its
      // "end-to-end encrypted" copy went with `FolioView`.
      await expect(
        page.getByRole("heading", { name: /this folio is encrypted/i }),
      ).toBeVisible({ timeout: 10_000 });
      // The plaintext marker must NOT be on the rendered page either.
      await expect(page.getByText(`LOOTBAG-${t}`)).toHaveCount(0);
    });

    await test.step("wrong passphrase shows generic failure, no plaintext leak", async () => {
      // Unlock happens inside the workspace now: the locked panel's own
      // Unlock button opens the passphrase dialog, in place of the
      // deleted read-only view's Clear ⇄ Encrypted switch.
      await page.getByRole("button", { name: /^unlock$/i }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await dialog.getByLabel(/^passphrase$/i).fill(wrongPassphrase);
      await dialog.getByRole("button", { name: /^unlock$/i }).click();
      await expect(dialog.getByText(/wrong passphrase/i)).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText(`LOOTBAG-${t}`)).toHaveCount(0);
    });

    await test.step("right passphrase reveals the original markdown", async () => {
      // The unlock dialog is still open from the failed attempt.
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(/^passphrase$/i).fill(passphrase);
      await dialog.getByRole("button", { name: /^unlock$/i }).click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      await expect(page.getByText(`LOOTBAG-${t}`).first()).toBeVisible({
        timeout: 30_000,
      });
      // Unlocked-state marker: the locked panel is gone and the folio is
      // an ordinary editable document again.
      await expect(
        page.getByRole("heading", { name: /this folio is encrypted/i }),
      ).toHaveCount(0);
    });
  });
});
