import { expect, type Page, test } from "@playwright/test";
import {
  apiPath,
  createCampaignViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * Petition end-to-end:
 *
 * 1. Owner registers, creates a campaign, enables the petition module.
 * 2. Lands on `/c/:id/request?path=…&type=bug`, fills + submits the form, and
 *    is redirected to the reporter's cross-campaign list at `/me/petitions`
 *    (the dedicated status page was retired in favour of this list).
 * 3. The petition shows up there as `pending`.
 * 4. Owner accepts the petition via API.
 * 5. Back on `/me/petitions`, the petition now shows as `accepted`.
 *
 * Linked-quest progression for reporters was removed with the status page; the
 * petition <-> quest plumbing lives in the controller unit tests. Other
 * features (quest lifecycle, etc.) have their own specs — see
 * apps/lore/CLAUDE.md for the convention.
 */

const apiPostParams = async <T>(
  page: Page,
  action: string,
  params: Record<string, string>,
  body?: unknown,
): Promise<T> => {
  let url = await apiPath(page, action);
  for (const [k, v] of Object.entries(params)) {
    url = url.replace(`:${k}`, v);
  }
  return (await page.evaluate(
    async ({ url, body }) => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) {
        throw new Error(`${r.status} ${await r.text()}`);
      }
      return r.json();
    },
    { url, body },
  )) as T;
};

test.describe("Petition", () => {
  test("submit via the form, list in /me, owner accepts → status updates", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const t = Date.now();
    const email = `petitioner${t}@example.com`;
    const password = "PetitionTest123!";
    const campaignTitle = `Pet${t}`.slice(0, 20);
    const petitionTitle = `Bug${t}`;
    const petitionDescription = `Repro:\n1. step one\n2. step two\nExpected: works\nActual: explodes`;
    const reportPath = "/checkout";
    const reportUrl = `https://customer-site.example.com${reportPath}`;

    await registerAndVerify(page, email, password);
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    // Wizard defaults petitions OFF — flip it on so the request form is
    // reachable.
    await page.evaluate(async (id) => {
      const res = await fetch(`/api/updateCampaignById/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: { petitions: true } }),
      });
      if (!res.ok)
        throw new Error(`enable petitions: ${res.status} ${await res.text()}`);
    }, campaignId);

    // ── Submit a petition through the UI request form ────────────────────────
    await test.step("submit petition via the request form", async () => {
      // Land on the request URL with the page-context query params the way the
      // `/sigil/request` proxy delivers them after a feedback-button click.
      await page.goto(
        `/c/${campaignId}/request?path=${encodeURIComponent(
          reportPath,
        )}&url=${encodeURIComponent(reportUrl)}&type=bug` +
          `&ua=${encodeURIComponent("CustomUA/9.9")}` +
          `&tz=${encodeURIComponent("Europe/Paris")}`,
      );
      await page.waitForLoadState("networkidle");

      // The request form is a single free-text field — the petition title is
      // derived from the first line server-side.
      await page
        .locator("textarea")
        .first()
        .fill(`${petitionTitle}\n${petitionDescription}`);

      await page.getByRole("button", { name: /^submit petition$/i }).click();

      // Successful submit redirects to the reporter's /me petitions list.
      await page.waitForURL(/\/auth\/profile\/petitions/, { timeout: 15_000 });
      await expect(page.getByText(petitionTitle, { exact: true })).toBeVisible({
        timeout: 10_000,
      });
    });

    // The list no longer carries the petition id in the URL — read it back
    // from the reporter list endpoint (most recent first).
    const latest = await page.evaluate(async () => {
      const r = await fetch("/api/me/petitions", { credentials: "include" });
      if (!r.ok) throw new Error(`list mine: ${r.status} ${await r.text()}`);
      const data = (await r.json()) as {
        content: Array<{
          id: number;
          source?: { hostUrl?: string; userAgent?: string; timezone?: string };
        }>;
      };
      return data.content[0] ?? null;
    });
    const petitionId = latest?.id ?? 0;
    expect(petitionId).toBeGreaterThan(0);

    // The sigil/proxy query params must be captured as the petition `source`
    // provenance the owner sees in the inbox.
    await test.step("captures page-context source from the request URL", () => {
      expect(latest?.source?.hostUrl).toBe(reportUrl);
      expect(latest?.source?.userAgent).toBe("CustomUA/9.9");
      expect(latest?.source?.timezone).toBe("Europe/Paris");
    });

    await test.step("petition shows as pending in the list", async () => {
      const row = page.getByRole("row").filter({ hasText: petitionTitle });
      await expect(row).toContainText(/pending/i);
    });

    // ── Owner accepts the petition (API) ─────────────────────────────────────
    await test.step("accept the petition (API)", async () => {
      await apiPostParams(page, "acceptPetition", {
        campaignId: String(campaignId),
        petitionId: String(petitionId),
      });
    });

    await test.step("list reflects the accepted status", async () => {
      await page.goto("/auth/profile/petitions");
      await page.waitForLoadState("networkidle");
      const row = page.getByRole("row").filter({ hasText: petitionTitle });
      await expect(row).toContainText(/accepted/i, { timeout: 10_000 });
    });
  });
});
