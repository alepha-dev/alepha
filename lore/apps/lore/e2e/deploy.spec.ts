import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import { createProjectViaWizard, registerAndVerify } from "./_helpers.ts";

/**
 * The deploy surface, from the switch that turns it on to the tabs it puts on
 * a copy.
 *
 * ## What this file is actually guarding
 *
 * Epic #36 defined `apps.deploy`, backfilled it `false` everywhere and
 * rendered it **disabled with a Soon badge**. Epic #1 built what it gates and
 * removed the badge. A switch that is present but inert looks exactly like a
 * switch that works until somebody clicks it, so the first step here asserts
 * the click has an effect rather than asserting the badge is absent.
 *
 * ## Two gates, one above the other
 *
 * The project's `apps.deploy` option decides whether this project has the
 * surface at all; the copy's own estate decides whether THIS copy has anywhere
 * to send anything. Both tabs need both, and each half is asserted on its own
 * so a pass cannot come from the other one.
 *
 * ⚠️ Neither is the security boundary: `$ownsProject`'s `capability` option
 * refuses server-side, and a hidden tab refuses nothing.
 */

/**
 * Two API calls the UI has its own screens for, driven directly because this
 * file is about the tabs and not about those screens - the same reasoning as
 * `createInstance` in `apps.spec.ts`.
 *
 * ⚠️ `page.evaluate`, so the session cookie travels. Playwright's `request`
 * fixture has its own empty jar and would arrive unauthenticated.
 */
const createInstance = async (
  page: Page,
  projectId: number,
  app: string,
  env: string,
): Promise<void> => {
  const ok = await page.evaluate(
    async ({ projectId, app, env }) => {
      const r = await fetch(`/api/projects/${projectId}/apps`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ app, env }),
      });
      return r.ok;
    },
    { projectId, app, env },
  );
  expect(ok).toBe(true);
};

/**
 * Create an estate and lend it to this project in one call, then point the
 * copy at it.
 *
 * A `bay` estate because it takes nothing but a slug: a cloudflare one needs an
 * account id and an API token, and what is under test is the tab appearing,
 * which only reads `estateId`.
 */
const giveAnEstate = async (
  page: Page,
  projectId: number,
  app: string,
  env: string,
  slug: string,
): Promise<void> => {
  const ok = await page.evaluate(
    async ({ projectId, app, env, slug }) => {
      const created = await fetch(`/api/projects/${projectId}/estates/new`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!created.ok) return false;
      const estate = (await created.json()) as { id: string };

      const linked = await fetch(
        `/api/projects/${projectId}/apps/${app}/${env}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ estateId: estate.id }),
        },
      );
      return linked.ok;
    },
    { projectId, app, env, slug },
  );
  expect(ok).toBe(true);
};

test.describe("deploying through Lore", () => {
  test("the deploy switch works, and the tabs it gates need an estate too", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const ts = Date.now();
    await registerAndVerify(page, `dep${ts}@example.com`, "GoodPassw0rd");
    const { slug, id: projectId } = await createProjectViaWizard(
      page,
      `Ship${ts}`.slice(0, 20),
      { capabilities: ["apps"] },
    );

    const appName = "club";
    const envName = "production";

    await test.step("the deploy option is a real switch, not a Soon badge", async () => {
      await page.goto(`/${slug}/settings/apps`);
      await page.waitForLoadState("networkidle");

      const deploy = page.getByRole("switch", { name: /^deploy apps$/i });
      await expect(deploy).toBeVisible();
      // ⚠️ Asserted through its EFFECT. `toBeEnabled()` would pass for a
      // switch whose click is swallowed; a response coming back is what says
      // the option is real.
      await expect(deploy).toHaveAttribute("aria-checked", "false");

      const saved = page.waitForResponse((res) =>
        res.url().includes("/capabilities/apps"),
      );
      await deploy.click();
      expect((await saved).ok()).toBe(true);
      await expect(deploy).toHaveAttribute("aria-checked", "true");
    });

    await test.step("a copy with no estate has neither tab", async () => {
      // The lower gate. The project can deploy; this copy has nowhere to send
      // anything, so there is no history to show and nothing to configure.
      await createInstance(page, projectId, appName, envName);
      await page.goto(`/${slug}/apps/${appName}/${envName}`);
      await page.waitForLoadState("networkidle");

      // ⚠️ Scoped to the tab bar and matched exactly, the way `apps.spec.ts`
      // does it: the tabs are links, not ARIA tabs, and "Deploy" appears in
      // page copy elsewhere.
      const tabs = page.getByTestId("app-tabs");
      await expect(
        tabs.getByRole("link", { name: "Artifacts", exact: true }),
      ).toBeVisible();
      await expect(
        tabs.getByRole("link", { name: "Deploy", exact: true }),
      ).toHaveCount(0);
      await expect(
        tabs.getByRole("link", { name: "Environment", exact: true }),
      ).toHaveCount(0);
    });

    await test.step("both tabs arrive once the copy has one", async () => {
      await giveAnEstate(page, projectId, appName, envName, `est-${ts}`);
      await page.goto(`/${slug}/apps/${appName}/${envName}`);
      await page.waitForLoadState("networkidle");

      const tabs = page.getByTestId("app-tabs");
      await expect(
        tabs.getByRole("link", { name: "Deploy", exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        tabs.getByRole("link", { name: "Environment", exact: true }),
      ).toBeVisible();
      // ⚠️ Settings stays last in every combination, which is what keeps the
      // bar stable as a copy gains capabilities.
      const labels = await tabs.getByRole("link").allInnerTexts();
      expect(labels.at(-1)?.toLowerCase()).toContain("settings");
    });

    await test.step("the Deploy tab says what is missing before it says nothing", async () => {
      await page.goto(`/${slug}/apps/${appName}/${envName}/deploy`);
      await page.waitForLoadState("networkidle");

      // Nothing has been pushed for this app, so the build list is empty and
      // the run list is empty - and neither reads as an error.
      await expect(page.getByTestId("app-deploy-runs")).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByText(/nothing has been deployed here/i),
      ).toBeVisible();
    });

    await test.step("the Environment tab holds no value and says so", async () => {
      await page.goto(`/${slug}/apps/${appName}/${envName}/environment`);
      await page.waitForLoadState("networkidle");

      await expect(page.getByTestId("app-environment")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(/nothing set yet/i)).toBeVisible();

      // ⚠️ The property the whole screen exists for: a value goes one way.
      // Set one, and the list names it without ever saying what it is.
      await page.getByTestId("app-environment-key").fill("STRIPE_SECRET_KEY");
      await page
        .getByTestId("app-environment-value")
        .fill("sk_live_abcdefghijkl");
      await page.getByTestId("app-environment-save").click();

      await expect(page.getByText("STRIPE_SECRET_KEY")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(/sk_live_abcdefghijkl/)).toHaveCount(0);
      await expect(page.getByText(/starts with sk_l/i)).toBeVisible();
    });

    await test.step("turning the option back off takes both tabs away", async () => {
      // ⚠️ Disabling HIDES and never deletes: the variable set above survives,
      // which is what makes turning it back on safe.
      await page.goto(`/${slug}/settings/apps`);
      await page.waitForLoadState("networkidle");

      const off = page.waitForResponse((res) =>
        res.url().includes("/capabilities/apps"),
      );
      await page.getByRole("switch", { name: /^deploy apps$/i }).click();
      expect((await off).ok()).toBe(true);

      await page.goto(`/${slug}/apps/${appName}/${envName}`);
      await page.waitForLoadState("networkidle");
      const tabs = page.getByTestId("app-tabs");
      await expect(
        tabs.getByRole("link", { name: "Artifacts", exact: true }),
      ).toBeVisible();
      await expect(
        tabs.getByRole("link", { name: "Deploy", exact: true }),
      ).toHaveCount(0);
    });
  });
});
