import { expect, type Page, test } from "@playwright/test";
import { createProjectViaWizard, registerAndVerify } from "./_helpers.ts";

/**
 * Outposts, end to end: turn the module on, enrol a machine, read its token
 * once, then rotate and delete it.
 *
 * An outpost is **one machine**, which is what separates it from a sigil: the
 * form asks only for a label, because the identity is the credential and two
 * machines sharing a name is a naming annoyance rather than a data problem.
 *
 * Two mechanical traps, both of which have cost this codebase time before:
 *
 * 1. Every `$action` the SPA calls is multiplexed through `POST /api/_batch`,
 *    so `waitForResponse` on a per-action URL never fires. Assert on rendered
 *    state instead.
 * 2. Base UI leaves `pointer-events: none` on `<body>` after a dialog closes,
 *    so the next click lands on nothing until React happens to re-render.
 */

const releasePointerEvents = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    document.body.style.pointerEvents = "";
  });
};

/**
 * Answer the confirmation `useDialog()` opened, by the label on its action
 * button. `AlertDialogAction` renders the `confirmLabel` verbatim.
 */
const confirmDialog = async (page: Page, label: string): Promise<void> => {
  const dialog = page.locator('[role="alertdialog"], [role="dialog"]').last();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: label, exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });
  await releasePointerEvents(page);
};

/**
 * Read the one-time token panel and dismiss it.
 *
 * The panel is the only place the cleartext token ever exists — the column
 * holds a hash — so this both captures it and asserts that dismissing really
 * takes it off the page.
 */
const takeMintedToken = async (page: Page): Promise<string> => {
  const panel = page.getByRole("alert").filter({ hasText: /Copy this token/i });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  const token = (await panel.locator("code").first().innerText()).trim();
  expect(token).toMatch(/^op_/);

  await panel.getByRole("button", { name: "Done", exact: true }).click();
  await expect(panel).toBeHidden({ timeout: 10_000 });
  await expect(page.getByText(token, { exact: true })).toHaveCount(0);

  return token;
};

test.describe("Outposts", () => {
  test("enrol a machine, rotate it, delete it", async ({ page }) => {
    test.setTimeout(180_000);

    const t = Date.now();
    const email = `outpost${t}@example.com`;
    const projectTitle = `Out${t}`.slice(0, 20);
    const machine = `OVH Bay ${t}`;

    await registerAndVerify(page, email, "OutpostTest123!");
    const projectId = await createProjectViaWizard(page, projectTitle);

    await test.step("the owner turns Outposts on from settings", async () => {
      await page.goto(`/p/${projectId}/settings/outposts`);
      await page.waitForLoadState("networkidle");

      // The settings page rendering at all is worth asserting: removing this
      // route without editing the nav array crashed every settings page once.
      await expect(
        page.getByRole("switch", { name: "Enable", exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      await page.getByRole("switch", { name: "Enable", exact: true }).click();

      // The enrol form only exists once the master toggle is on.
      await expect(page.getByPlaceholder("OVH Bay")).toBeVisible({
        timeout: 15_000,
      });
    });

    await test.step("enrolling shows the token exactly once", async () => {
      await page.getByPlaceholder("OVH Bay").fill(machine);
      await page.getByRole("button", { name: "Enrol", exact: true }).click();

      const token = await takeMintedToken(page);

      // Only the prefix survives, on the row.
      await expect(page.getByText(machine, { exact: false })).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        page.getByText(token.slice(0, 11), { exact: false }).first(),
      ).toBeVisible();
      // A machine that has never reported says so, rather than showing a date.
      await expect(
        page.getByText("never reported", { exact: false }).first(),
      ).toBeVisible();
    });

    await test.step("the machine appears on the Outposts page", async () => {
      // Driven from the board rather than from settings on purpose: the
      // settings nav has its own "Outposts" link, so clicking by name there
      // matches two elements and trips Playwright's strict mode. Scope to
      // the actual sidebar container (`[data-slot="sidebar"]`, from
      // @alepha/ui's shadcn `<Sidebar>`) rather than a bare role/text
      // lookup — the sidebar has no ARIA landmark of its own, and an
      // unscoped locator would collide with the settings nav's identical
      // link once that page is visited.
      await page.goto(`/p/${projectId}/`);
      await page.waitForLoadState("networkidle");

      const sidebar = page.locator('[data-slot="sidebar"]');
      // The sidebar groups are unlabelled now (no more "Domain" heading —
      // the great rename, Task 9); the Outposts link itself only renders
      // once the module is on, so assert that directly.
      const sidebarOutposts = sidebar.getByRole("link", {
        name: "Outposts",
        exact: true,
      });
      await expect(sidebarOutposts).toBeVisible({
        timeout: 15_000,
      });
      await sidebarOutposts.click();
      await page.waitForURL(`**/p/${projectId}/outposts`);

      await expect(page.getByText(machine, { exact: false })).toBeVisible({
        timeout: 15_000,
      });
      // Never reported: no agent, no date, and it must say so plainly.
      await expect(
        page.getByText("Never connected", { exact: false }),
      ).toBeVisible();
      await expect(page.getByText("unknown", { exact: false })).toBeVisible();

      await page.goto(`/p/${projectId}/settings/outposts`);
      await page.waitForLoadState("networkidle");
      // Wait for the list to rehydrate before the next step clicks Rotate.
      await expect(
        page.getByRole("button", { name: "Rotate", exact: true }),
      ).toBeVisible({ timeout: 15_000 });
    });

    await test.step("rotating mints a new token and keeps the row", async () => {
      await page.getByRole("button", { name: "Rotate", exact: true }).click();
      await confirmDialog(page, "Rotate");
      await takeMintedToken(page);
      await expect(page.getByText(machine, { exact: false })).toBeVisible();
    });

    await test.step("deleting removes it", async () => {
      await page.getByRole("button", { name: "Delete outpost" }).click();
      await confirmDialog(page, "Delete");
      await expect(page.getByText(machine, { exact: false })).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(
        page.getByText("No machine enrolled yet", { exact: false }),
      ).toBeVisible({ timeout: 15_000 });
    });
  });
});
