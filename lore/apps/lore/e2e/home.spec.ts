import { expect, test } from "./_fixtures.ts";
import {
  apiPost,
  createProjectViaWizard,
  registerAndVerify,
} from "./_helpers.ts";

/**
 * Home is the only SSR'd route, and a signed-in visitor with projects gets
 * the dashboard there. Its standfirst says "Refreshed <relative time>", which
 * `fromNow()` computes relative to now — so it mismatches between the server
 * render and client hydration (clock drift / unit boundary) → React #418. The
 * fix is the same one Home's project list used to carry: `<ClientOnly>`, so
 * the relative time never appears in the server HTML.
 *
 * The mismatch itself is timing-dependent (it only fires on a unit boundary),
 * so a "no console error" check would be a false green. This asserts the
 * deterministic mechanism instead: the relative time is NOT server-rendered
 * but DOES appear after hydration.
 */
test.describe("Home (SSR)", () => {
  test("the relative 'refreshed' time is client-only, not in the SSR HTML", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const t = Date.now();
    const email = `home${t}@example.com`;
    const projectTitle = `Home${t}`.slice(0, 20);

    await registerAndVerify(page, email, "HomeTest123!");
    await createProjectViaWizard(page, projectTitle);

    // Raw server-rendered HTML for the authenticated home page (page.request
    // shares the browser context's session cookie).
    const html = await (await page.request.get("/")).text();

    // The rail IS server-rendered (the project title is in the SSR HTML)...
    expect(html).toContain(projectTitle);
    // ...but no relative time is. A dashboard resolved seconds ago reads as
    // "a few seconds ago" / "a minute ago".
    expect(html).not.toContain("seconds ago");
    expect(html).not.toContain("minute ago");

    // After hydration it appears client-side.
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/refreshed .*ago/i).first()).toBeVisible({
      timeout: 15_000,
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
/**
 * The dashboard's rail and the project switcher show five projects;
 * everything else lives at `/account/projects`.
 *
 * Six is the fixture on purpose — the smallest number that truncates. With
 * five the "see all" link must NOT appear, and a test built on five would pass
 * against a cap that had silently stopped working.
 */
test.describe("Home (recent projects cap)", () => {
  test("caps at five, and the rest are on the account page", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const t = Date.now();
    await registerAndVerify(page, `cap${t}@example.com`, "CapTest123!");

    // The first goes through the wizard because that is what creates the
    // session's project context; the rest go through the API, which is far
    // cheaper than five more wizard runs and is what the count needs.
    const { slug: firstSlug } = await createProjectViaWizard(
      page,
      `Cap${t}`.slice(0, 20),
    );
    for (const title of ["Atlas", "Beacon", "Cinder", "Drift", "Ember"]) {
      await apiPost(page, "createProject", {
        title: `${title}${t}`.slice(0, 20),
      });
    }

    await page.goto("/");
    await expect(page.getByTestId("dashboard-rail-see-all")).toBeVisible({
      timeout: 15_000,
    });
    // Five rows, not six — the assertion the whole feature exists for.
    await expect(page.getByTestId("dashboard-rail-project")).toHaveCount(5);

    await page.getByTestId("dashboard-rail-see-all").click();
    await page.waitForURL("**/account/projects", { timeout: 15_000 });
    await expect(page.getByTestId("account-project-row")).toHaveCount(6);

    // Every one of them was created by this account, so every row says Owner.
    // The badge is derived from `createdBy`, so a page that rendered no badge
    // at all would still pass a bare row count.
    await expect(page.getByText("Owner").first()).toBeVisible();

    // The switcher caps too, and always keeps the project you are looking at.
    // `firstSlug` is the LEAST recently updated of the six (it was created
    // first), so it is exactly the case that falls outside the top five — open
    // its switcher and it must still be listed, or the checkmark disappears
    // and the menu reads as though you are nowhere.
    await page.goto(`/${firstSlug}/`);
    await page.getByTestId("project-switcher").click();
    await expect(page.getByTestId("switcher-all-projects")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole("menuitem").filter({ hasText: `Cap${t}`.slice(0, 20) }),
    ).toBeVisible();

    // Every project row is a real anchor pointing at that project's slug, not
    // a button with an onClick — the difference is invisible on a plain click
    // and is the whole affordance on shift/⌘/middle-click (Lore feedback #61).
    // Asserted on a row that is NOT the active one, so a fix that special-cased
    // the current project would not pass.
    await expect(
      page.getByRole("menuitem").filter({ hasText: `Ember${t}`.slice(0, 20) }),
    ).toHaveAttribute("href", /^\/[a-z0-9-]+$/);
  });
});

test.describe("Home (signed out)", () => {
  test("'Start your first project' reaches the register page", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /start your first project/i }).click();

    await expect(page).toHaveURL(/\/auth\/register\?/);
    // The intent survives, and with it the message and the seeded redirect —
    // landing on a bare register form would mean the intent was dropped.
    await expect(page).toHaveURL(/intent=createProject/);
    await expect(page).toHaveURL(/redirect=/);
    await expect(page.getByText(/before creating a project/i)).toBeVisible();
  });

  test("'Already registered? Sign in' reaches the login page", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /already registered/i }).click();

    await expect(page).toHaveURL(/\/auth\/login/);
  });
});
