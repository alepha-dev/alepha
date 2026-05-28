import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page, test } from "@playwright/test";
import { createCampaignViaWizard, registerAndVerify } from "./_helpers.ts";

/**
 * Sigils — embedded petition end-to-end (Quest #92).
 *
 * Exercises the whole embedded-petition path the way a partner site would:
 *
 * 1. Owner registers, creates a campaign, enables the `petitions`,
 *    `sigils` and `embeddedPetitions` features (the wizard leaves all
 *    three OFF), then creates a sigil through the Settings → Sigils UI
 *    with the fixture server's origin in `allowedOrigins` and the
 *    `petition` capability checked.
 * 2. A tiny second HTTP server serves a fixture HTML page from a
 *    DIFFERENT origin (a separate port → a separate origin) that embeds
 *    `<script src="<lore>/sigils/<id>/embed.js">`.
 * 3. The bundle mounts a Shadow-DOM icon-only button (MessageSquareWarning,
 *    accessible name "Feedback") — clicking it `window.open`s the petition
 *    popup at `/sigils/:id/request`.
 * 4. Fill + submit the petition form inside the popup.
 * 5. The opener (fixture page) receives the `lore.sigil.submitted`
 *    postMessage — captured via a listener injected before submit.
 * 6. The owner's petition inbox shows the petition carrying its `source`
 *    block: the "via Sigil · host" badge is visible.
 *
 * Cross-origin matters: the embed bundle's CORS and the popup's
 * `postMessage` origin checks are keyed to the sigil's `allowedOrigins`,
 * so the fixture MUST be served from an origin distinct from the Lore
 * server. We stand up a `http.createServer` on an ephemeral port inside
 * the test and tear it down at the end; `127.0.0.1:<port>` is a different
 * origin from the Lore server's `localhost:3303`.
 */

test.describe("Sigils — embedded petition", () => {
  test("embed → click feedback → submit petition → owner inbox shows source", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150_000);

    const loreOrigin = baseURL!;
    const t = Date.now();
    const email = `sigil${t}@example.com`;
    const password = "SigilTest123!";
    const campaignTitle = `Sig${t}`.slice(0, 20);
    const petitionTitle = `EmbedBug${t}`;
    const petitionDescription =
      "Repro:\n1. open the partner page\n2. click Feedback\nExpected: works";

    // ── Owner setup ──────────────────────────────────────────────────────
    await registerAndVerify(page, email, password);
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    // The wizard leaves petitions / sigils / embeddedPetitions OFF.
    // `petitions` makes the request form reachable, `sigils` reveals the
    // Sigils settings UI — flip those via API. `embeddedPetitions` is
    // driven through its real Settings → Sigils UI Switch below, so the
    // toggle itself is exercised end-to-end.
    await page.evaluate(async (id) => {
      const res = await fetch(`/api/updateCampaignById/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          features: {
            petitions: true,
            sigils: true,
          },
        }),
      });
      if (!res.ok) {
        throw new Error(`enable features: ${res.status} ${await res.text()}`);
      }
    }, campaignId);

    // ── Stand up the cross-origin fixture server ─────────────────────────
    // It serves a single HTML page. The sigil id is only known after the
    // sigil is created, so the page reads it from `?sigil=` on its own URL
    // and injects the embed <script> at runtime.
    const fixtureServer = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Partner site</title></head>
  <body>
    <h1>Partner checkout page</h1>
    <p>Embedded Lore sigil demo.</p>
    <script>
      // Record the opener-bound postMessage so the test can assert it.
      window.__loreSigilSubmitted = null;
      window.addEventListener("message", function (e) {
        var d = e.data || {};
        if (d.type === "lore.sigil.submitted") {
          window.__loreSigilSubmitted = d;
        }
      });
      (function () {
        var sigilId = ${JSON.stringify("")} ||
          new URLSearchParams(location.search).get("sigil");
        if (!sigilId) return;
        var s = document.createElement("script");
        s.src = ${JSON.stringify(loreOrigin)} + "/sigils/" + sigilId + "/embed.js";
        document.head.appendChild(s);
      })();
    </script>
  </body>
</html>`);
    });
    await new Promise<void>((resolve) =>
      fixtureServer.listen(0, "127.0.0.1", resolve),
    );
    const fixturePort = (fixtureServer.address() as AddressInfo).port;
    const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;

    try {
      // ── Create a sigil via the Settings → Sigils UI ────────────────────
      let sigilId = "";
      await test.step("create a sigil through the settings UI", async () => {
        await page.goto(`/c/${campaignId}/settings/sigils`);
        await page.waitForLoadState("networkidle");

        // Enable the Petitions capability via its real Settings UI Switch
        // (not the API). `petitions` is already ON, so the Switch is
        // enabled. The label was renamed from "Embedded petitions" to
        // just "Petitions".
        const embeddedToggle = page.getByRole("switch", {
          name: /^petitions$/i,
        });
        await expect(embeddedToggle).toBeEnabled();
        await embeddedToggle.click();
        await expect(embeddedToggle).toBeChecked();

        // The create form now lives behind a "New sigil" button → dialog.
        await page.getByRole("button", { name: /^new sigil$/i }).click();
        const labelInput = page.locator("#sigil-label");
        await expect(labelInput).toBeVisible({ timeout: 15_000 });

        await labelInput.fill(`Partner ${t}`);
        await page.locator("#sigil-origins").fill(fixtureOrigin);
        // The `petition` capability checkbox — un-locked because
        // `embeddedPetitions` was just toggled on via the UI.
        // Click the Label, not `#sigil-kind-petition`: Base UI's
        // Checkbox renders a hidden <input> with the id and a visible
        // button sibling. Clicking the input directly trips Playwright's
        // pointer-events check against the dialog backdrop because the
        // input is positioned off-screen. The label is the intended
        // click surface.
        const petitionKind = page.locator("#sigil-kind-petition");
        await expect(petitionKind).toBeEnabled();
        await page
          .getByText(/^Petitions$/, { exact: true })
          .last()
          .click();
        await expect(petitionKind).toBeChecked();

        const createBtn = page.getByRole("button", {
          name: /^create sigil$/i,
        });
        await createBtn.click();

        // The new sigil card renders with a Copy snippet action — proof
        // the create round-trip succeeded and the list reloaded.
        await expect(
          page.getByRole("button", { name: /copy snippet/i }),
        ).toBeVisible({ timeout: 15_000 });

        // Resolve the freshly created sigil's id via the owner API so the
        // fixture page can target it.
        const created = await page.evaluate(async (id) => {
          const r = await fetch(`/api/c/${id}/sigils`, {
            credentials: "include",
          });
          if (!r.ok) throw new Error(`listSigils: ${r.status}`);
          return (await r.json()) as { items: Array<{ id: string }> };
        }, campaignId);
        expect(created.items.length).toBeGreaterThan(0);
        sigilId = created.items[0].id;
        expect(sigilId).not.toEqual("");
      });

      // ── Load the cross-origin fixture page; it embeds the bundle ───────
      await test.step("load the partner page embedding the sigil", async () => {
        await page.goto(`${fixtureOrigin}/?sigil=${sigilId}`);
        // The bundle mounts a Shadow-DOM host with an icon-only Feedback
        // button (accessible name comes from aria-label since there's no
        // text content after #101).
        await expect(
          page.getByRole("button", { name: "Feedback" }),
        ).toBeVisible({ timeout: 15_000 });
      });

      // ── Click Feedback → capture the petition popup ────────────────────
      let popup: Page;
      await test.step("click Feedback → popup opens at /sigils/:id/request", async () => {
        const popupPromise = page.waitForEvent("popup", { timeout: 30_000 });
        await page.getByRole("button", { name: "Feedback" }).click();
        popup = await popupPromise;
        await popup.waitForLoadState("domcontentloaded");
        // The popup opens at /sigils/:id/request and the server 302s it to
        // the SPA request route /c/:campaignId/request?sigil=…
        await popup.waitForURL(/\/c\/\d+\/request/, { timeout: 20_000 });
        expect(popup.url()).toContain(`sigil=${sigilId}`);
      });

      // ── Fill + submit the petition form in the popup ───────────────────
      await test.step("fill + submit the petition form", async () => {
        await popup.waitForLoadState("networkidle");
        // The owner is already authenticated in this context, so the popup
        // shows the full form (not the sign-in CTA). The request form is a
        // single free-text field — the petition title is derived from the
        // first line server-side.
        await popup
          .locator("textarea")
          .first()
          .fill(`${petitionTitle}\n${petitionDescription}`);

        await popup.getByRole("button", { name: /^submit petition$/i }).click();

        // The popup posts `lore.sigil.submitted` to the opener then closes.
        await popup.waitForEvent("close", { timeout: 20_000 });
      });

      // ── Assert the opener received the postMessage ─────────────────────
      await test.step("opener receives lore.sigil.submitted", async () => {
        await expect
          .poll(
            async () =>
              page.evaluate(
                () =>
                  (window as unknown as { __loreSigilSubmitted: unknown })
                    .__loreSigilSubmitted,
              ),
            { timeout: 10_000 },
          )
          .not.toBeNull();
        const received = (await page.evaluate(
          () =>
            (
              window as unknown as {
                __loreSigilSubmitted: { type?: string; sigilId?: string };
              }
            ).__loreSigilSubmitted,
        )) as { type?: string; sigilId?: string };
        expect(received.type).toBe("lore.sigil.submitted");
        expect(received.sigilId).toBe(sigilId);
      });

      // ── Owner inbox: the petition carries its source block ─────────────
      await test.step("owner inbox shows the via-Sigil badge", async () => {
        await page.goto(`/c/${campaignId}/petitions`);
        await page.waitForLoadState("networkidle");

        // The submitted petition row is visible by title.
        await expect(page.getByText(petitionTitle).first()).toBeVisible({
          timeout: 15_000,
        });
        // The "via Sigil" provenance badge proves `source.sigilId` is set.
        await expect(page.getByText(/via sigil/i).first()).toBeVisible();

        // Confirm the persisted petition carries the full source block.
        const list = await page.evaluate(async (id) => {
          const r = await fetch(
            `/api/campaigns/${id}/petitions?status=pending`,
            {
              credentials: "include",
            },
          );
          if (!r.ok) throw new Error(`listPetitions: ${r.status}`);
          return (await r.json()) as {
            items: Array<{
              title: string;
              source?: { sigilId?: string; hostUrl?: string };
            }>;
          };
        }, campaignId);
        const row = list.items.find((p) => p.title === petitionTitle);
        expect(row, "submitted petition present in owner inbox").toBeTruthy();
        expect(row?.source?.sigilId).toBe(sigilId);
        expect(row?.source?.hostUrl).toContain(fixtureOrigin);
      });
    } finally {
      await new Promise<void>((resolve) =>
        fixtureServer.close(() => resolve()),
      );
    }
  });
});
