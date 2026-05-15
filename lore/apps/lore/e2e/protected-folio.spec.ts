import * as fs from "node:fs";
import { expect, test } from "@playwright/test";
import {
  clearEmails,
  createCampaignViaWizard,
  emailDir,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * Protected folios (Lore quest #50) — end-to-end encrypted folios. The
 * core contracts under test:
 *
 *  1. Create flow: a folio created with "Protect this folio" on + a
 *     passphrase persists ciphertext server-side. The server payload
 *     for that folio's `content` is a JSON envelope, never plaintext.
 *  2. Wrong passphrase rejection: the unlock card surfaces a generic
 *     "Wrong passphrase" error and DOESN'T leak the plaintext.
 *  3. Right passphrase round-trip: same passphrase reveals the original
 *     markdown body, including a marker we put in to make accidental
 *     plaintext leakage detectable.
 *
 * Crypto runs in the browser via `BrowserCryptoProvider`. We don't mock
 * Web Crypto — Playwright's Chromium has it natively. The PBKDF2 600k
 * iterations is slow (~1s on Chromium), so test timeouts are bumped.
 */
test.describe("Protected folio", () => {
  test.beforeAll(() => {
    fs.mkdirSync(emailDir, { recursive: true });
    clearEmails();
  });

  test("create → fail with wrong passphrase → unlock with right one", async ({
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

    await test.step("create a protected folio via the editor", async () => {
      // Navigate via SPA — direct `page.goto('/folios/new')` from the
      // landing page lands on the campaign root for reasons that look
      // like an SSR/hydration race. Going through the Folios link is
      // closer to the user flow anyway.
      await page
        .getByRole("link", { name: /^folios$/i })
        .first()
        .click();
      await page.waitForURL(new RegExp(`/c/${campaignId}/folios`), {
        timeout: 15_000,
      });
      // Two "New folio" anchors are on the page (sidebar icon + empty-
      // state CTA when the campaign has zero folios). Either works.
      await page
        .getByRole("link", { name: /^new folio$/i })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: /new folio/i }),
      ).toBeVisible({ timeout: 15_000 });

      // The folio title input is the one with the "Untitled" placeholder.
      await page.getByPlaceholder(/^untitled$/i).fill(folioTitle);

      // Toggle "Protect this folio" — the switch is the only `role=switch`
      // on this page.
      await page.getByRole("switch").click();
      await expect(page.getByLabel(/^passphrase$/i)).toBeVisible({
        timeout: 5_000,
      });

      await page.getByLabel(/^passphrase$/i).fill(passphrase);
      await page.getByLabel(/confirm passphrase/i).fill(passphrase);

      // Content goes into the markdown textarea. With autoSave off, we
      // need to submit explicitly via the Save button in the header.
      await page.getByPlaceholder(/start writing markdown/i).fill(folioBody);

      await page.getByRole("button", { name: /^save$/i }).click();
      await page.waitForURL(new RegExp(`/c/${campaignId}/folios/\\d+`), {
        timeout: 30_000,
      });
    });

    await test.step("server-stored content is an envelope, never plaintext", async () => {
      // Hit the same list endpoint the layout loader uses; assert the
      // freshly-created folio's content shape.
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

    await test.step("page reloads into the locked card (key not cached)", async () => {
      await page.reload();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(/protected folio/i).first()).toBeVisible({
        timeout: 10_000,
      });
      // The plaintext marker must NOT be on the rendered page either.
      await expect(page.getByText(`LOOTBAG-${t}`)).toHaveCount(0);
    });

    await test.step("wrong passphrase shows generic failure, no plaintext leak", async () => {
      const input = page.getByLabel(/^passphrase$/i);
      await input.fill(wrongPassphrase);
      await page.getByRole("button", { name: /^unlock$/i }).click();
      await expect(page.getByText(/wrong passphrase/i)).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText(`LOOTBAG-${t}`)).toHaveCount(0);
    });

    await test.step("right passphrase reveals the original markdown", async () => {
      const input = page.getByLabel(/^passphrase$/i);
      await input.fill(passphrase);
      await page.getByRole("button", { name: /^unlock$/i }).click();
      await expect(page.getByText(`LOOTBAG-${t}`).first()).toBeVisible({
        timeout: 30_000,
      });
      // Unlocked-state markers: badge + Lock-now button.
      await expect(page.getByText(/unlocked/i).first()).toBeVisible();
    });
  });
});
