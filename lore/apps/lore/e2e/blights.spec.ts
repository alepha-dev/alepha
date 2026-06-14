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

  test("sigil filter, ignore rules, and mass delete", async ({ page }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    const email = `blightui${t}@example.com`;
    const campaignTitle = `BU${t}`.slice(0, 20);

    await registerAndVerify(page, email, "BlightTest123!");
    const campaignId = await createCampaignViaWizard(page, campaignTitle);

    // Enable the sigils master toggle + the blights capability, then mint a
    // blights-capable sigil and ingest two distinct crashes through the
    // trusted server-to-server endpoint.
    const sigilId = await page.evaluate(async (id) => {
      const enable = await fetch(`/api/updateCampaignById/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: { sigils: true, blights: true } }),
      });
      if (!enable.ok)
        throw new Error(`enable: ${enable.status} ${await enable.text()}`);

      const created = await fetch(`/api/c/${id}/sigils`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "ui sigil", kinds: ["blights"] }),
      });
      if (!created.ok)
        throw new Error(`sigil: ${created.status} ${await created.text()}`);
      const sigil = await created.json();

      const ingest = await fetch(`/sigils/${sigil.id}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          errors: [
            {
              name: "TypeError",
              message: "x is not a function",
              origin: "server",
            },
            { name: "RangeError", message: "out of range", origin: "server" },
          ],
        }),
      });
      if (ingest.status !== 204)
        throw new Error(`ingest: ${ingest.status} ${await ingest.text()}`);

      return sigil.id as string;
    }, campaignId);
    expect(sigilId).toBeTruthy();

    await page.goto(`/c/${campaignId}/blights`);
    await page.waitForLoadState("networkidle");

    // Both crashes are listed.
    await expect(page.getByText("TypeError")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("RangeError")).toBeVisible();

    // The "filter by sigil" dropdown is present (defaults to "All sigils").
    await expect(page.getByText("All sigils")).toBeVisible();

    // Ignore-rules dialog: open it, add a rule, see it listed.
    await page.getByRole("button", { name: "Ignore rules" }).click();
    await expect(page.getByText(/Drop incoming crashes/i)).toBeVisible();
    await page.getByPlaceholder("e.g. Unknown club").fill("Unknown club");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Unknown club", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    // Close the dialog (Escape).
    await page.keyboard.press("Escape");

    // Mass delete: select all rows, confirm, inbox empties.
    page.on("dialog", (dialog) => dialog.accept());
    await page.getByLabel("Select all rows").click();
    await page.getByRole("button", { name: "Delete selected" }).click();

    await expect(page.getByText(/No blights\./i)).toBeVisible({
      timeout: 10_000,
    });
  });
});
