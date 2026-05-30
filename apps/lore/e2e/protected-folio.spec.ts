import { expect, test } from "@playwright/test";
import { createCampaignViaWizard, registerAndVerify } from "./_helpers.ts";

/**
 * Protected folios (Lore quest #50) — end-to-end encrypted folios. As of
 * the encryption-UX rework, encryption is no longer chosen at create time;
 * a clear folio is encrypted from its view via an Encrypt action, and an
 * encrypted folio is read through a Clear ⇄ Encrypted toggle. The core
 * contracts under test:
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
    const campaignTitle = `PF${t}`.slice(0, 20);
    const passphrase = "correct horse battery staple";
    const wrongPassphrase = "wrong donkey panini sample";
    const folioTitle = `Secret${t}`;
    // Distinctive plaintext marker — used to verify both round-trip
    // success AND ciphertext-never-on-wire (the marker must NOT appear
    // in the server response for the folio's content).
    const folioBody = `LOOTBAG-${t} — known-good marker for round-trip assertion`;

    await registerAndVerify(page, email, password);
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    await test.step("create a clear folio via the editor", async () => {
      // Navigate via SPA — direct `page.goto('/archive/new')` from the
      // landing page lands on the campaign root for reasons that look
      // like an SSR/hydration race. Going through the Archive link is
      // closer to the user flow anyway. Quest #66 renamed the sidebar
      // label from "Folios" → "Archive".
      await page
        .getByRole("link", { name: /^archive$/i })
        .first()
        .click();
      await page.waitForURL(new RegExp(`/c/${campaignId}/archive`), {
        timeout: 15_000,
      });
      // Archive toolbar: open the "Create" dropdown, then pick "New folio".
      await page.getByRole("button", { name: /^create$/i }).click();
      await page
        .getByRole("menuitem", { name: /^new folio$/i })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: /new folio/i }),
      ).toBeVisible({ timeout: 15_000 });

      // The folio title input is the one with the "Untitled" placeholder.
      await page.getByPlaceholder(/^untitled$/i).fill(folioTitle);
      await page.getByPlaceholder(/start writing markdown/i).fill(folioBody);

      // No encryption toggle any more — save as a clear folio, land on
      // its view.
      await page.getByRole("button", { name: /^save$/i }).click();
      await page.waitForURL(new RegExp(`/c/${campaignId}/archive/\\d+`), {
        timeout: 30_000,
      });
    });

    await test.step("encrypt the folio from its view", async () => {
      // The header Encrypt icon-button (aria-label "Encrypt") opens the
      // set-passphrase dialog.
      await page
        .getByRole("button", { name: /^encrypt$/i })
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
        const r = await fetch(`/api/list?campaignId=${cid}&limit=100`, {
          credentials: "include",
        });
        if (!r.ok) throw new Error(`list: ${r.status}`);
        return (await r.json()) as Array<{
          title: string;
          protected: boolean;
          content: string;
        }>;
      }, campaignId)) as Array<{
        title: string;
        protected: boolean;
        content: string;
      }>;

      const folio = folios.find((f) => f.title === folioTitle);
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
      await expect(page.getByText(/end-to-end encrypted/i).first()).toBeVisible(
        { timeout: 10_000 },
      );
      // The plaintext marker must NOT be on the rendered page either.
      await expect(page.getByText(`LOOTBAG-${t}`)).toHaveCount(0);
    });

    await test.step("wrong passphrase shows generic failure, no plaintext leak", async () => {
      // Flip the Clear ⇄ Encrypted toggle toward Clear → unlock dialog.
      await page.getByRole("switch").click();
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
      // Unlocked-state marker: the toggle now reads "Clear".
      await expect(page.getByText(/^clear$/i).first()).toBeVisible();
    });
  });
});
