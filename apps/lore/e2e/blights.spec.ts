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

  test("a source files blights and the inbox shows them", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    const email = `source${t}@example.com`;
    const campaignTitle = `SR${t}`.slice(0, 20);

    await registerAndVerify(page, email, "BlightTest123!");
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    const token = await page.evaluate(async (id) => {
      const enable = await fetch(`/api/updateCampaignById/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: { blights: true } }),
      });
      if (!enable.ok) throw new Error(`enable: ${enable.status}`);

      const created = await fetch(`/api/c/${id}/sources`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "e2e pulse" }),
      });
      if (!created.ok) throw new Error(`source: ${created.status}`);
      return (await created.json()).token as string;
    }, campaignId);

    /**
     * Filed through Playwright's request context, deliberately NOT the page.
     *
     * Two reasons it cannot go through the page. Alepha patches the browser's
     * `fetch` to attach the session bearer, which silently replaces the source
     * key; and any request carrying the session cookie is resolved as that
     * user. A reporter holds no cookie and no session — this is what one looks
     * like.
     */
    const file = async (windowCount: number) => {
      const res = await request.post("/api/blights/ingest", {
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        data: {
          fingerprints: [
            {
              fingerprint: "e2e-fp-1",
              name: "TypeError",
              message: "x is not a function",
              stackSample: "TypeError: x\n    at f (app.js:1:1)",
              origin: "server",
              windowCount,
              firstSeenAt: new Date().toISOString(),
              lastSeenAt: new Date().toISOString(),
            },
          ],
        },
      });
      if (!res.ok()) {
        throw new Error(`ingest: ${res.status()} ${await res.text()}`);
      }
      return await res.json();
    };

    await file(3);
    // A second batch for the same fingerprint must merge, not duplicate.
    const result = await file(4);
    expect(result.accepted).toBe(1);

    await page.goto(`/c/${campaignId}/blights`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("x is not a function")).toBeVisible({
      timeout: 10_000,
    });
    // 3 + 4 on one row: the real magnitude, not two rows of one.
    await expect(page.getByText("7", { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
