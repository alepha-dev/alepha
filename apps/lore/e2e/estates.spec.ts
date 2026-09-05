import type { Page } from "@playwright/test";

import { expect, test } from "./_fixtures.ts";
import {
  newUserContext,
  registerAndVerify,
  signInAsAdmin,
} from "./_helpers.ts";

/**
 * Estates, end to end, from the owner's account page (#1838): create one and
 * see its secret exactly once, flip a switch and watch the row follow the
 * server's answer, queue a restart that waits for a machine that is not
 * there, and delete it through a dialog that says what deleting does not do.
 * Then the admin backstop: every estate on the instance, and no credential.
 *
 * No machine ever connects here. The connector's side is #1624's container
 * test and #1628's end-to-end; this file is the page.
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
  await page.getByTestId("estate-create-slug").fill(slug);
  await page.getByTestId("estate-create-submit").click();

  // The only moment the cleartext secret exists. Shown, then gone for good.
  // The long match is the token; the card below shows a short masked prefix
  // of the same shape, which must still be there once the panel is gone.
  await expect(page.getByText(/est_[A-Za-z0-9_-]{16,}/)).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText(/est_[A-Za-z0-9_-]{16,}/)).toHaveCount(0);
};

test.describe("Estates", () => {
  test("an owner creates an estate, flips a switch, queues a restart, and deletes it", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const email = `estate-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    await page.goto("/account/estates");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("You own no estate yet")).toBeVisible();

    await createEstate(page, "ovh-1");

    const card = page.getByTestId("my-estate-card");
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId("my-estate-slug")).toHaveText("ovh-1");
    await expect(card.getByText("offline", { exact: true })).toBeVisible();
    await expect(card.getByText("stats only", { exact: true })).toBeVisible();
    await expect(card.getByText("Not lent to any project.")).toBeVisible();
    // The masked prefix names the credential; the credential itself is gone.
    await expect(card.getByText(/secret est_/)).toBeVisible();

    // The badge follows the server's answer, not the click, and survives a
    // reload because the row was written.
    await card.getByTestId("my-estate-deploys").click();
    await expect(
      card.getByText("deploys allowed", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.waitForLoadState("networkidle");
    const reloaded = page.getByTestId("my-estate-card");
    await expect(
      reloaded.getByText("deploys allowed", { exact: true }),
    ).toBeVisible();

    // A restart queues as pending: no machine holds this estate's socket, so
    // the command waits for its next hello rather than failing.
    await reloaded.getByTestId("my-estate-restart-app").fill("lore");
    await reloaded
      .getByTestId("my-estate-restart-environment")
      .fill("production");
    await reloaded.getByTestId("my-estate-restart").click();
    const command = reloaded.getByTestId("my-estate-command");
    await expect(command).toHaveCount(1);
    await expect(command.first()).toContainText("pending");
    await expect(command.first()).toContainText("lore/production");

    // Delete says what it does NOT do, then takes the card with it.
    await reloaded.getByTestId("my-estate-delete").click();
    const dialog = page.locator('[role="alertdialog"], [role="dialog"]').last();
    await expect(dialog).toContainText("Nothing is undeployed");
    await expect(dialog).toContainText("not revoked at Cloudflare");
    await confirmDialog(page, "Delete");
    await expect(page.getByTestId("my-estate-card")).toHaveCount(0);
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
