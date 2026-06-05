import { expect, test } from "@playwright/test";
import { createCampaignViaWizard, registerAndVerify } from "./_helpers.ts";

/**
 * Home is the only SSR'd route. The campaign list's "Updated <relative time>"
 * uses `fromNow()`, which is relative-to-now and therefore mismatches between
 * the server render and client hydration (clock drift / unit boundary) →
 * React #418. The fix wraps the relative time in `<ClientOnly>` so it never
 * appears in the server HTML.
 *
 * The mismatch itself is timing-dependent (only fires on a unit boundary), so
 * a "no console error" check would be a false green. Instead we assert the
 * deterministic mechanism of the fix: the relative time is NOT server-rendered
 * but DOES appear after hydration.
 */
test.describe("Home (SSR)", () => {
  test("the relative 'updated' time is client-only, not in the SSR HTML", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `home${t}@example.com`;
    const campaignTitle = `Home${t}`.slice(0, 20);

    await registerAndVerify(page, email, "HomeTest123!");
    await createCampaignViaWizard(page, campaignTitle);

    // Raw server-rendered HTML for the authenticated home page (page.request
    // shares the browser context's session cookie).
    const html = await (await page.request.get("/")).text();

    // The campaign list IS server-rendered (the title is in the SSR HTML)...
    expect(html).toContain(campaignTitle);
    // ...but the relative "updated" time is NOT — it's behind <ClientOnly>, so
    // server + first client render match and React #418 can't fire. A freshly
    // created campaign reads as "a few seconds ago" / "a minute ago".
    expect(html).not.toContain("seconds ago");
    expect(html).not.toContain("minute ago");

    // After hydration it appears client-side.
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/updated .*ago/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
