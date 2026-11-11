import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  confirmDialog,
  createProjectViaWizard,
  createRankFromPreset,
  newUserContext,
  registerAndVerify,
  releasePointerEvents,
  signInAsAdmin,
} from "./_helpers.ts";

/**
 * Estates belong to a project, managed by rank (epic #E126, #Q3281).
 *
 * In the browser, on built artefacts: a plain Member of the home project
 * reads the console and is offered nothing to change, a member on the Admin
 * preset (which carries `estate:update`, `estate:create`, `estate:delete`)
 * rotates, the owner moves the estate to another project from Settings, and
 * the instance admin assigns it back from `/admin/estates`.
 *
 * ⚠️ No suite can make an estate with no home (only the migration does), so
 * the admin assigns one that has a home; the homeless row is a browser spec
 * (`AdminEstates.browser.spec.tsx`) and a server spec (`estate-move.spec.ts`).
 */

const inviteWithRank = async (
  page: Page,
  slug: string,
  email: string,
  rankName: RegExp,
): Promise<void> => {
  await page.goto(`/${slug}/settings/members`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^invite$/i }).click();
  await expect(
    page.getByRole("heading", { name: /invite a user/i }),
  ).toBeVisible();
  await page.getByPlaceholder("user@example.com").fill(email);
  await page.getByTestId("invite-rank").click();
  await page.getByRole("option", { name: rankName }).click();
  await expect(page.getByRole("option", { name: rankName })).toBeHidden();
  const created = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/invitations"),
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: /send invitation/i }).click();
  expect((await created).ok()).toBe(true);
};

const accept = async (page: Page, projectTitle: string): Promise<void> => {
  await page.goto("/account/invitations");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByText(projectTitle).first()).toBeVisible({
    timeout: 10_000,
  });
  const accepted = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/api\/invitations\/[^/]+\/accept$/.test(r.url()),
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: /^accept$/i }).click();
  expect((await accepted).ok()).toBe(true);
};

/**
 * Create a bay estate from the account page, in the only project the caller
 * can create one in, and dismiss the one-time secret. Answers its id.
 */
const createEstate = async (page: Page, slug: string): Promise<string> => {
  await page.goto("/account/estates");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("estate-create-open").click();
  await page.getByTestId("estate-create-slug").fill(slug);
  await page.getByTestId("estate-create-submit").click();
  const reveal = page.getByTestId("my-estate-secret-dialog");
  await expect(reveal).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await releasePointerEvents(page);
  await page
    .getByRole("row")
    .filter({ has: page.getByText(slug, { exact: true }) })
    .getByTestId("my-estate-row")
    .click();
  await page.waitForURL(/\/account\/estates\/[0-9a-f-]{36}/, {
    timeout: 15_000,
  });
  return new URL(page.url()).pathname.split("/")[3]!;
};

const openSettings = async (page: Page, estateId: string): Promise<void> => {
  await page.goto(`/account/estates/${estateId}/settings`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("bay-settings-home")).toBeVisible({
    timeout: 15_000,
  });
};

test.describe("Project estates", () => {
  test("a member looks, a manager rotates, the owner moves it, the admin assigns it", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    const ts = Date.now();
    await registerAndVerify(page, `pe-owner-${ts}@example.com`, "GoodPassw0rd");
    const first = await createProjectViaWizard(page, `Pe1${ts}`.slice(0, 20), {
      capabilities: ["apps"],
    });
    const estateId = await createEstate(page, "ovh-team");

    // The Admin preset carries the three estate permissions since #E126.
    await createRankFromPreset(page, first.slug, "Admin");
    const reader = await newUserContext(browser, baseURL!, "pe-reader");
    const manager = await newUserContext(browser, baseURL!, "pe-manager");
    try {
      const title = `Pe1${ts}`.slice(0, 20);
      await inviteWithRank(page, first.slug, reader.email, /^member$/i);
      await accept(reader.page, title);
      await inviteWithRank(page, first.slug, manager.email, /^admin$/i);
      await accept(manager.page, title);

      // ── A plain Member: the console, read-only ──────────────────────────
      await reader.page.goto("/account/estates");
      await reader.page.waitForLoadState("networkidle");
      await expect(reader.page.getByTestId("my-estate-readonly")).toBeVisible({
        timeout: 15_000,
      });
      await openSettings(reader.page, estateId);
      await expect(
        reader.page.getByTestId("bay-settings-readonly"),
      ).toBeVisible();
      await expect(reader.page.getByTestId("bay-settings-rotate")).toHaveCount(
        0,
      );
      await expect(reader.page.getByTestId("bay-settings-delete")).toHaveCount(
        0,
      );

      // ── A manager on the Admin rank: rotates ────────────────────────────
      await openSettings(manager.page, estateId);
      await expect(
        manager.page.getByTestId("bay-settings-readonly"),
      ).toHaveCount(0);
      await manager.page.getByTestId("bay-settings-rotate").click();
      await confirmDialog(manager.page, "Rotate");
      await expect(
        manager.page.getByTestId("my-estate-secret-dialog"),
      ).toBeVisible({ timeout: 15_000 });
      await manager.page
        .getByRole("button", { name: "Done", exact: true })
        .click();
    } finally {
      await reader.ctx.close();
      await manager.ctx.close();
    }

    // ── The owner moves it to a second project ─────────────────────────────
    const second = await createProjectViaWizard(page, `Pe2${ts}`.slice(0, 20), {
      capabilities: ["apps"],
    });
    await openSettings(page, estateId);
    await page.getByTestId("bay-settings-move").click();
    await page.getByTestId("bay-move-project").click();
    await page.getByRole("option", { name: `Pe2${ts}`.slice(0, 20) }).click();
    await releasePointerEvents(page);
    await page.getByTestId("bay-move-submit").click();
    await expect(page.getByTestId("bay-settings-home")).toContainText(
      `Pe2${ts}`.slice(0, 20),
      { timeout: 15_000 },
    );
    await page.goto(`/${second.slug}/settings/estates`);
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByTestId("home-estate-row").filter({ hasText: "ovh-team" }),
    ).toBeVisible({ timeout: 15_000 });

    // ── The admin assigns it back to the first ─────────────────────────────
    const adminCtx = await browser.newContext({ baseURL });
    const admin = await adminCtx.newPage();
    try {
      await signInAsAdmin(admin);
      await admin.goto("/admin/estates");
      await admin.waitForLoadState("networkidle");
      const row = admin.locator("tbody tr", {
        has: admin.getByText("ovh-team", { exact: true }),
      });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.getByRole("button", { name: /actions/i }).click();
      await admin.getByRole("menuitem", { name: "Assign to project" }).click();
      await admin.getByTestId("admin-estate-assign-project").click();
      await admin
        .getByRole("option", { name: new RegExp(`^Pe1${ts}`.slice(0, 20)) })
        .click();
      await releasePointerEvents(admin);
      await admin.getByTestId("admin-estate-assign-submit").click();
      await expect(row).toContainText(`Pe1${ts}`.slice(0, 20), {
        timeout: 15_000,
      });
    } finally {
      await adminCtx.close();
    }
  });
});
