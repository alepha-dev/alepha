import { expect, test } from "@playwright/test";
import { createCampaignViaWizard, registerAndVerify } from "./_helpers.ts";

/**
 * Sigils — module-driven server-to-server contract (approach b2).
 *
 * The new `@alepha/sigil` flow is fully server-to-server: the partner app's
 * `SigilForwardProvider` POSTs to `POST /sigils/:id/ingest` and
 * `POST /sigils/:id/petition` using only the sigil UUID as a credential.
 * There is no embedded `<script>`, no cross-origin widget, no popup.
 *
 * These endpoints are NOT `isProduction()`-gated on the Lore receiving side —
 * only the `@alepha/sigil` module's forwarding side is. So the full server
 * contract can be exercised against the e2e test server (dev or prod-like)
 * via Playwright's `request` API without any production-mode wiring.
 *
 * What this spec covers:
 *
 * 1. Owner registers, creates a campaign, enables the `sigils`,
 *    `embeddedPetitions`, `blights`, and `beacon` feature toggles.
 * 2. Owner creates a sigil with `kinds: ["beacon", "blights", "petition"]`
 *    via the owner-facing CRUD API.
 * 3. `POST /sigils/:id/ingest` with a views batch → `sigil_views` row lands.
 * 4. `POST /sigils/:id/ingest` with an errors batch → blight lands in the
 *    owner's Blights inbox (`GET /campaigns/:id/blights`).
 * 5. `POST /sigils/:id/petition` with a multipart form → petition lands in
 *    the owner's Petitions inbox with `source.sigilId` set.
 * 6. The petition's `source.sigilId` round-trips correctly.
 *
 * No `SIGIL_ID` / `LORE_URL` / `NODE_ENV=production` injection is needed
 * because we drive the Lore-SERVER endpoints directly — these are the
 * endpoints the `@alepha/sigil` module CALLS, not the module itself.
 */

test.describe("Sigils — module-driven server-to-server contract", () => {
  test("ingest views + errors → inbox; petition → inbox with source", async ({
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

    // Enable all sigil-related features: sigils (master toggle), blights,
    // beacon (views analytics), embeddedPetitions (petition capability gate).
    // The wizard leaves them all off; flip them via the owner API.
    await page.evaluate(async (id) => {
      const res = await fetch(`/api/updateCampaignById/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          features: {
            sigils: true,
            blights: true,
            beacon: true,
            embeddedPetitions: true,
            petitions: true,
          },
        }),
      });
      if (!res.ok) {
        throw new Error(`enable features: ${res.status} ${await res.text()}`);
      }
    }, campaignId);

    // ── Create a sigil via the owner API ─────────────────────────────────
    // We go through the API directly (not the settings UI) because:
    //  a) The old spec already drove the UI — the HTTP contract is what's new.
    //  b) UI coverage for sigil creation lives in the settings-features spec.
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
            kinds: ["beacon", "blights", "petition"],
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
    // The trusted server-to-server endpoint accepts views, errors, and vitals
    // in one batch. Post a single pageview and assert 204 (no content).
    await test.step("POST /sigils/:id/ingest with views → 204", async () => {
      const res = await request.post(`${baseURL}/sigils/${sigilId}/ingest`, {
        headers: { "content-type": "application/json" },
        data: {
          views: [{ path: "/checkout" }],
          country: "FR",
        },
      });
      // 204 = success, no body. The endpoint is fire-and-forget.
      expect(res.status()).toBe(204);
    });

    // ── POST /sigils/:id/ingest — errors batch → blight ──────────────────
    // The unique error message is used to identify this specific blight later.
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

    // ── Assert blight lands in the owner's Blights inbox ─────────────────
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

    // ── POST /sigils/:id/petition — multipart form ────────────────────────
    // The trusted petition endpoint accepts a multipart form. We post via
    // Playwright's `request.post` with `multipart` to match what
    // `SigilForwardProvider.forwardPetition` sends.
    const petitionTitle = `SigilPetition_${t}`;
    const petitionDescription =
      "Repro:\n1. open checkout\n2. click Pay\nExpected: success";
    await test.step("POST /sigils/:id/petition → 200 with { id }", async () => {
      const res = await request.post(`${baseURL}/sigils/${sigilId}/petition`, {
        multipart: {
          title: petitionTitle,
          description: petitionDescription,
          type: "bug",
          hostUrl: "https://partner.example.com/checkout",
          hostPath: "/checkout",
          reporterEmail: "user@partner.example.com",
        },
      });
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { id: number };
      expect(body.id).toBeGreaterThan(0);
    });

    // ── Assert petition lands in the owner's Petitions inbox ──────────────
    await test.step("petition is visible in the campaign petitions inbox with source.sigilId", async () => {
      const result = await page.evaluate(
        async ({ id }) => {
          const r = await fetch(
            `/api/campaigns/${id}/petitions?status=pending`,
            {
              credentials: "include",
            },
          );
          if (!r.ok)
            throw new Error(`listPetitions: ${r.status} ${await r.text()}`);
          return (await r.json()) as {
            items: Array<{
              title: string;
              source?: {
                sigilId?: string;
                hostUrl?: string;
                hostPath?: string;
              };
            }>;
          };
        },
        { id: campaignId },
      );

      const petition = result.items.find((p) => p.title === petitionTitle);
      expect(
        petition,
        "submitted petition present in owner inbox",
      ).toBeTruthy();
      expect(petition?.source?.sigilId).toBe(sigilId);
      expect(petition?.source?.hostUrl).toBe(
        "https://partner.example.com/checkout",
      );
      expect(petition?.source?.hostPath).toBe("/checkout");
    });

    // ── Gate check: ingest rejects a bad sigil UUID ───────────────────────
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
