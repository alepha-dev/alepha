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

/**
 * The logged-out call to action has to survive a *client-side* transition, not
 * just a direct load.
 *
 * `AuthRegisterPage` seeds `?redirect=` on arrival so the post-register flow
 * knows where to land. It used to build that URL from `window.location.href` —
 * correct on a direct load, wrong when clicking through from Home, because the
 * router renders the new page before it writes history and the effect still
 * saw `/`. The CTA rewrote the address back to Home and read as a dead link.
 *
 * Every register spec navigates straight to `/auth/register`, so none of them
 * exercised the transition. This one clicks the button a signed-out visitor
 * actually clicks.
 */
test.describe("Home (signed out)", () => {
  test("'Start your first campaign' reaches the register page", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("link", { name: /start your first campaign/i })
      .click();

    await expect(page).toHaveURL(/\/auth\/register\?/);
    // The intent survives, and with it the message and the seeded redirect —
    // landing on a bare register form would mean the intent was dropped.
    await expect(page).toHaveURL(/intent=createCampaign/);
    await expect(page).toHaveURL(/redirect=/);
    await expect(page.getByText(/before creating a campaign/i)).toBeVisible();
  });

  test("'Already registered? Sign in' reaches the login page", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /already registered/i }).click();

    await expect(page).toHaveURL(/\/auth\/login/);
  });
});
