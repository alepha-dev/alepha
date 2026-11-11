import { expect, test } from "./_fixtures.ts";
import {
  confirmDialog,
  createEstateInProject,
  createProjectViaWizard,
  newUserContext,
  registerAndVerify,
  signInAsAdmin,
} from "./_helpers.ts";

/**
 * Estates, end to end, from the project that is their home (#1838, #E126):
 * create one in the project's Settings ▸ Apps ▸ Estates and see its secret
 * exactly once, open the console its row leads to, under the project, flip a
 * switch and see it stored, and delete it through a dialog that says what
 * deleting does not do. Then the admin backstop: every estate on the
 * instance, and no credential.
 *
 * ⚠️ Estates have no account page since #E126: they belong to a project, and
 * the project's estates list is where they are. What the console draws once
 * a machine has reported is `bay-console.spec.ts`, which plays a machine
 * over the real socket; nothing connects here, which is why the console
 * shows its never-connected state.
 *
 * Every `$action` call the SPA makes goes through `POST /api/_batch`, so
 * nothing here waits on a named response: the assertions are on rendered
 * state, which only changes once the server has answered.
 */
test.describe("Estates", () => {
  test("an owner creates an estate in a project, opens its console there, flips a switch, and deletes it", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const email = `estate-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");
    // An estate belongs to a project with Apps on (#E126).
    const project = await createProjectViaWizard(
      page,
      `Est${Date.now()}`.slice(0, 20),
      { capabilities: ["apps"] },
    );

    await page.goto(`/${project.slug}/settings/estates`);
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText("This project is the home of no estate."),
    ).toBeVisible({ timeout: 15_000 });

    await createEstateInProject(page, project.slug, "ovh-1");
    // The reveal is gone for good once dismissed: the column stores a hash.
    await expect(page.getByText(/est_[A-Za-z0-9_-]{16,}/)).toHaveCount(0);

    const row = page.getByTestId("home-estate-row");
    await expect(row).toHaveCount(1);
    await expect(row.getByText("offline", { exact: true })).toBeVisible();
    await expect(
      row.getByText("Lent to this project", { exact: false }),
    ).toBeVisible();

    // A `bay` row opens its console, a page of the project (#E126).
    await row.getByRole("link", { name: "ovh-1", exact: true }).click();
    await page.waitForURL(`**/${project.slug}/estates/ovh-1`, {
      timeout: 15_000,
    });
    // Nothing has ever connected, so the console says so rather than drawing
    // empty gauges.
    await expect(
      page.getByText("this machine has never connected"),
    ).toBeVisible({ timeout: 15_000 });

    // The switch follows the server's answer, not the click.
    await page
      .getByTestId("bay-tabs")
      .getByRole("link", { name: "Settings", exact: true })
      .click();
    await page.waitForURL(`**/${project.slug}/estates/ovh-1/settings`, {
      timeout: 15_000,
    });
    await page.getByTestId("bay-settings-deploys").click();
    await expect(page.getByTestId("bay-settings-deploys")).toHaveAttribute(
      "aria-checked",
      "true",
      { timeout: 15_000 },
    );
    // Read back from a fresh load: the stored row, not this page's copy.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("bay-settings-deploys")).toHaveAttribute(
      "aria-checked",
      "true",
      { timeout: 15_000 },
    );

    // Delete says what it does NOT do, then lands back on the project's
    // estates list, because the console cannot stay open over an estate
    // that no longer exists.
    await page.getByTestId("bay-settings-delete").click();
    const dialog = page.locator('[role="alertdialog"], [role="dialog"]').last();
    await expect(dialog).toContainText("Nothing is undeployed");
    await expect(dialog).toContainText("not revoked at Cloudflare");
    await confirmDialog(page, "Delete");
    await page.waitForURL(`**/${project.slug}/settings/estates`, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("home-estate-row")).toHaveCount(0);
    await expect(
      page.getByText("This project is the home of no estate."),
    ).toBeVisible();
  });

  test("the admin list shows every estate on the instance, and no credential", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);

    // The owner enrols in their own context; the admin looks from another.
    const owner = await newUserContext(browser, baseURL ?? "", "estate-owner");
    const project = await createProjectViaWizard(
      owner.page,
      `Adm${Date.now()}`.slice(0, 20),
      { capabilities: ["apps"] },
    );
    await createEstateInProject(owner.page, project.slug, "hetzner");
    await owner.ctx.close();

    await signInAsAdmin(page);
    await page.goto("/admin/estates");
    await page.waitForLoadState("networkidle");

    const row = page.locator("tbody tr", {
      has: page.getByText("hetzner", { exact: true }),
    });
    await expect(row).toBeVisible({ timeout: 15_000 });
    // ⚠️ Scoped to the row, not the page. This list shows EVERY estate on the
    // instance - which is what the test is named for - and the suite runs
    // fully parallel over one server per worker, so a sibling test's estate is
    // on this page too and reads `offline` as well. Unscoped, the assertion
    // was a strict-mode violation whenever another estate happened to exist,
    // which made it pass or fail on test ORDER.
    await expect(row.getByText("offline", { exact: true })).toBeVisible();
    // The masking rule has no exception for the admin role: nothing shaped
    // like a secret is on this page, prefix included.
    await expect(page.getByText(/est_[A-Za-z0-9_-]+/)).toHaveCount(0);
  });
});
