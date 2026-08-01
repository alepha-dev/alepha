import { expect, test } from "@playwright/test";
import { createCampaignViaWizard, registerAndVerify } from "./_helpers.ts";

/**
 * Regression guard for the Blights inbox infinite render loop.
 *
 * `CampaignBlights` pushes the open-count to the sidebar badge atom from its
 * AlephaTable `fetch`. It used to do so via a *subscribing* `useStore`, so each
 * fetch re-rendered the component → new inline `fetch` prop → refetch → write
 * badge → … an infinite loop. The fix: write the badge with a non-subscribing
 * `store.set`, and AlephaTable treats `fetch` as a latest-wins data source.
 *
 * A render loop throws "Maximum update depth exceeded" → the error boundary,
 * so the inbox chrome never renders. We assert the chrome IS visible and the
 * crash screen is NOT.
 *
 * Scope: this file guards the inbox *component*. Filing a blight and watching
 * it arrive belongs to the credential that files it, and lives in
 * `sigil.spec.ts` — which covers the ingest → inbox → merge path end to end.
 * The previous second test here drove `POST /api/c/:id/sources` and
 * `POST /api/blights/ingest`, both deleted with the source model.
 */
test.describe("Blights", () => {
  test("inbox renders without an infinite render loop", async ({ page }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `blight${t}@example.com`;
    const campaignTitle = `BL${t}`.slice(0, 20);

    await registerAndVerify(page, email, "BlightTest123!");
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    // The blights route is gated on the module toggle.
    await page.evaluate(async (id) => {
      const res = await fetch(`/api/updateCampaignById/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: { blights: true } }),
      });
      if (!res.ok)
        throw new Error(`enable blights: ${res.status} ${await res.text()}`);
    }, campaignId);

    await page.goto(`/c/${campaignId}/blights`);
    await page.waitForLoadState("networkidle");

    // Inbox chrome renders (status filter defaults to "Open"; the empty-state
    // message shows for a campaign with no blights) → the page is stable.
    await expect(page.getByText("Open").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/No blights\./i)).toBeVisible({
      timeout: 10_000,
    });
    // ...and it did NOT spin into "Maximum update depth" → error boundary.
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
  });
});
