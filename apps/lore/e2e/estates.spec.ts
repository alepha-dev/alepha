import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  newUserContext,
  registerAndVerify,
  signInAsAdmin,
} from "./_helpers.ts";

/**
 * Estates, end to end, from the owner's account page (#1838): create one and
 * see its secret exactly once, open the console the row leads to, flip a
 * switch and watch the account page follow the server's answer, and delete it
 * through a dialog that says what deleting does not do. Then the admin
 * backstop: every estate on the instance, and no credential.
 *
 * ⚠️ This file is the ACCOUNT page and the estate's lifecycle. What the
 * console draws once a machine has reported is `bay-console.spec.ts`, which
 * plays a machine over the real socket; nothing connects here, which is why
 * the console shows its never-connected state.
 *
 * The connector's own side is #1624's container test and #1628's
 * end-to-end.
 *
 * Every `$action` call the SPA makes goes through `POST /api/_batch`, so
 * nothing here waits on a named response: the assertions are on rendered
 * state, which only changes once the server has answered.
 */

/**
 * Base UI leaves `pointer-events: none` on `<body>` after a dialog closes, and
 * the next click then lands on nothing until React happens to re-render.
 */
const releasePointerEvents = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    document.body.style.pointerEvents = "";
  });
};

const confirmDialog = async (page: Page, label: string): Promise<void> => {
  const dialog = page.locator('[role="alertdialog"], [role="dialog"]').last();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: label, exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await releasePointerEvents(page);
};

/**
 * Create an estate from the account page and dismiss the one-time secret.
 */
const createEstate = async (page: Page, slug: string): Promise<void> => {
  await page.goto("/account/estates");
  await page.waitForLoadState("networkidle");
  // Creation is behind a dialog since #1862: the inline card was always
  // present, above every estate, so the page opened on the form for the
  // thing you do least often.
  await page.getByTestId("estate-create-open").click();
  await page.getByTestId("estate-create-slug").fill(slug);
  await page.getByTestId("estate-create-submit").click();

  // The only moment the cleartext secret exists. Shown in a dialog that
  // stays open until dismissed, then gone for good - the page it used to sit
  // on re-renders on every switch below it, and the column stores a hash.
  // The long match is the token; the row shows a short masked prefix of the
  // same shape, which must still be there once the dialog is gone.
  const reveal = page.getByTestId("my-estate-secret-dialog");
  await expect(reveal).toBeVisible({ timeout: 15_000 });
  await expect(reveal.getByText(/est_[A-Za-z0-9_-]{16,}/)).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText(/est_[A-Za-z0-9_-]{16,}/)).toHaveCount(0);
  await releasePointerEvents(page);
};

test.describe("Estates", () => {
  test("an owner creates an estate, opens its console, flips a switch, and deletes it", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const email = `estate-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    await page.goto("/account/estates");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("You own no estate yet")).toBeVisible();

    await createEstate(page, "ovh-1");

    // The ROW carries the four facts worth a glance since #1862; everything
    // else is behind it.
    const row = page.getByTestId("my-estate-row");
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("my-estate-slug")).toHaveText("ovh-1");
    await expect(row.getByText("offline", { exact: true })).toBeVisible();
    await expect(row.getByText("stats only", { exact: true })).toBeVisible();
    // The masked prefix names the credential; the credential itself is gone.
    await expect(row.getByText(/secret est_/)).toBeVisible();

    /*
     * ⚠️ A `bay` row opens its CONSOLE, not the drawer (#E37). The switches,
     * the loans, the commands and both destructive actions moved to
     * `/bay/:estateId/settings` when the machine got pages of its own, and
     * the restart form that used to sit in the drawer went with them: a verb
     * belongs on the instance it names, not on a free-text pair of fields.
     *
     * `MyEstateDrawer` still exists and is still the `cloudflare` path, which
     * `MyEstates.browser.spec.tsx` covers - `createEstate` refuses any type
     * but `bay`, so there is no such estate to make here.
     */
    await row.click();
    await page.waitForURL(/\/bay\/[0-9a-f-]{36}/, { timeout: 15_000 });
    await expect(page.getByTestId("my-estate-drawer")).toHaveCount(0);
    await expect(page.getByText("ovh-1").first()).toBeVisible();
    // Nothing has ever connected, so the console says so rather than drawing
    // empty gauges.
    await expect(
      page.getByText("this machine has never connected"),
    ).toBeVisible({ timeout: 15_000 });

    // The switch follows the server's answer, not the click.
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.waitForURL(/\/bay\/[0-9a-f-]{36}\/settings/, {
      timeout: 15_000,
    });
    await page.getByTestId("bay-settings-deploys").click();
    await expect(page.getByTestId("bay-settings-deploys")).toHaveAttribute(
      "aria-checked",
      "true",
      { timeout: 15_000 },
    );

    // Read back from the account page, which re-fetches: the badge there is
    // the stored row rather than this page's optimistic copy.
    await page.goto("/account/estates");
    await page.waitForLoadState("networkidle");
    const reloadedRow = page.getByTestId("my-estate-row");
    await expect(
      reloadedRow.getByText("deploys allowed", { exact: true }),
    ).toBeVisible();

    // Delete says what it does NOT do, then takes the row with it and lands
    // back here, because the console cannot stay open over an estate that no
    // longer exists.
    await reloadedRow.click();
    await page.waitForURL(/\/bay\/[0-9a-f-]{36}/, { timeout: 15_000 });
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByTestId("bay-settings-delete").click();
    const dialog = page.locator('[role="alertdialog"], [role="dialog"]').last();
    await expect(dialog).toContainText("Nothing is undeployed");
    await expect(dialog).toContainText("not revoked at Cloudflare");
    await confirmDialog(page, "Delete");
    await page.waitForURL(/\/account\/estates/, { timeout: 15_000 });
    await expect(page.getByTestId("my-estate-row")).toHaveCount(0);
    await expect(page.getByText("You own no estate yet")).toBeVisible();
  });

  test("the admin list shows every estate on the instance, and no credential", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    // The owner enrols in their own context; the admin looks from another.
    const owner = await newUserContext(browser, baseURL ?? "", "estate-owner");
    await createEstate(owner.page, "hetzner");
    await owner.ctx.close();

    await signInAsAdmin(page);
    await page.goto("/admin/estates");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("hetzner", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("offline", { exact: true })).toBeVisible();
    // The masking rule has no exception for the admin role: nothing shaped
    // like a secret is on this page, prefix included.
    await expect(page.getByText(/est_[A-Za-z0-9_-]+/)).toHaveCount(0);
  });
});
