import { expect, test } from "@playwright/test";
import { createCampaignViaWizard, registerAndVerify } from "./_helpers.ts";

/**
 * Sigils — telemetry server-to-server contract (approach b2).
 *
 * The `@alepha/sigil` telemetry flow is server-to-server: the partner app's
 * `SigilForwardProvider` POSTs to `POST /sigils/:id/ingest` using only the
 * sigil UUID as a credential. Petitions are NOT part of this contract anymore
 * — the sigil feedback button just opens the first-party Lore request page
 * (`/c/:campaignId/request`); the module resolves the campaign via
 * `GET /sigils/:id/campaign`.
 *
 * These endpoints are NOT `isProduction()`-gated on the Lore receiving side,
 * so the full server contract can be exercised against the e2e test server via
 * Playwright's `request` API without any production-mode wiring.
 *
 * What this spec covers:
 * 1. Owner registers, creates a campaign, enables sigils/blights/beacon.
 * 2. Owner creates a sigil with `kinds: ["beacon", "blights"]`.
 * 3. `POST /sigils/:id/ingest` (views) → 204.
 * 4. `POST /sigils/:id/ingest` (errors) → blight in the Blights inbox.
 * 5. `GET /sigils/:id/campaign` → resolves to the sigil's campaign id.
 * 6. Unknown sigil id → 404.
 */

test.describe("Sigils — telemetry server-to-server contract", () => {
  test("ingest views + errors → inbox; campaign resolver; bad id → 404", async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    const email = `sigil${t}@example.com`;
    const password = "SigilTest123!";
    const campaignTitle = `Sig${t}`.slice(0, 20);

    // ── Owner setup ──────────────────────────────────────────────────────
    await registerAndVerify(page, email, password);
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    // Enable the telemetry features (the wizard leaves them off).
    await page.evaluate(async (id) => {
      const res = await fetch(`/api/updateCampaignById/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          features: { sigils: true, blights: true, beacon: true },
        }),
      });
      if (!res.ok) {
        throw new Error(`enable features: ${res.status} ${await res.text()}`);
      }
    }, campaignId);

    // ── Create a sigil via the owner API ─────────────────────────────────
    let sigilId = "";
    await test.step("create sigil via owner API", async () => {
      const created = await page.evaluate(async (id) => {
        const r = await fetch(`/api/c/${id}/sigils`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: `E2E sigil ${id}`,
            allowedOrigins: ["https://partner.example.com"],
            kinds: ["beacon", "blights"],
            excludedPaths: [],
          }),
        });
        if (!r.ok) {
          throw new Error(`createSigil: ${r.status} ${await r.text()}`);
        }
        return (await r.json()) as { id: string };
      }, campaignId);

      expect(created.id).toBeTruthy();
      sigilId = created.id;
    });

    // ── POST /sigils/:id/ingest — views batch ─────────────────────────────
    await test.step("POST /sigils/:id/ingest with views → 204", async () => {
      const res = await request.post(`${baseURL}/sigils/${sigilId}/ingest`, {
        headers: { "content-type": "application/json" },
        data: { views: [{ path: "/checkout" }], country: "FR" },
      });
      expect(res.status()).toBe(204);
    });

    // ── POST /sigils/:id/ingest — errors batch → blight ──────────────────
    const blightMessage = `SigilE2ETestError_${t}`;
    await test.step("POST /sigils/:id/ingest with errors → 204", async () => {
      const res = await request.post(`${baseURL}/sigils/${sigilId}/ingest`, {
        headers: { "content-type": "application/json" },
        data: {
          errors: [
            {
              name: "TypeError",
              message: blightMessage,
              stack: `TypeError: ${blightMessage}\n  at checkout (/app/checkout.js:42:10)`,
              sourceUrl: "https://partner.example.com/checkout",
              origin: "client",
            },
          ],
        },
      });
      expect(res.status()).toBe(204);
    });

    await test.step("blight is visible in the campaign blights inbox", async () => {
      const result = await page.evaluate(async (id) => {
        const r = await fetch(`/api/campaigns/${id}/blights`, {
          credentials: "include",
        });
        if (!r.ok)
          throw new Error(`listBlights: ${r.status} ${await r.text()}`);
        return (await r.json()) as {
          items: Array<{ message: string; name: string; status: string }>;
          openCount: number;
        };
      }, campaignId);

      const blight = result.items.find((b) => b.message === blightMessage);
      expect(blight, "submitted blight present in owner inbox").toBeTruthy();
      expect(blight?.name).toBe("TypeError");
      expect(blight?.status).toBe("open");
      expect(result.openCount).toBeGreaterThan(0);
    });

    // ── GET /sigils/:id/campaign — the petition-popup resolver ────────────
    await test.step("GET /sigils/:id/campaign resolves to the campaign id", async () => {
      const res = await request.get(`${baseURL}/sigils/${sigilId}/campaign`);
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { campaignId: number };
      expect(body.campaignId).toBe(campaignId);
    });

    // ── Gate check: unknown sigil UUID → 404 ──────────────────────────────
    await test.step("ingest with unknown sigil id → 404", async () => {
      const res = await request.post(
        `${baseURL}/sigils/00000000-0000-0000-0000-000000000000/ingest`,
        {
          headers: { "content-type": "application/json" },
          data: { views: [{ path: "/test" }] },
        },
      );
      expect(res.status()).toBe(404);
    });
  });
});
