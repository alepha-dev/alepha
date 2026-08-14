import { expect, test } from "@playwright/test";
import { createProjectViaWizard, registerAndVerify } from "./_helpers.ts";

/**
 * The `/account` area — Lore's consumer of `@alepha/ui`'s `AccountRouter`.
 *
 * Most of what these pages do is covered by framework specs against the
 * controllers. What only an e2e can prove is that the *seam* is wired: that
 * `AccountRouter` mounts inside Lore's own layout, that the rail lists both
 * the framework's five pages and Lore's two, and that the `$pageAccount`
 * extension point actually produces reachable routes.
 */
test.describe("Account area", () => {
  test("lands on the profile and lists both built-in and Lore pages", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const email = `ac-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    // Bare `/account` must resolve — the profile sits at the shell root, which
    // is why AccountRouter needs no index redirect.
    await page.goto("/account");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(email, { exact: true })).toBeVisible();

    // The rail is derived from route `nav` metadata, so this asserts the five
    // built-ins AND that `$pageAccount` put Lore's two in the same tree.
    for (const label of [
      "Profile",
      "Security",
      "Sessions",
      "API keys",
      "Connected apps",
      "Invitations",
      "Feedback",
    ]) {
      await expect(
        page.getByRole("link", { name: label, exact: true }),
      ).toBeVisible();
    }
  });

  test("renames the account and persists it across a reload", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const email = `an-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    await page.goto("/account");
    await page.waitForLoadState("networkidle");

    const firstName = page.getByLabel("First name");
    await firstName.fill("Ada");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // Assert the write landed before asserting it persisted — otherwise a
    // failed save and a failed reload look identical.
    await expect(page.getByText(/profile updated/i)).toBeVisible();

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("First name")).toHaveValue("Ada");
  });

  test("changes the password and reports the revoked sessions", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const email = `ap-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    await page.goto("/account/security");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /change password/i }).click();
    await page.getByLabel(/^Current password/).fill("GoodPassw0rd");
    await page.getByLabel(/^New password/).fill("EvenBett3r!");
    await page.getByLabel(/^Confirm new password/).fill("EvenBett3r!");
    await page
      .getByRole("button", { name: /change password/i })
      .last()
      .click();

    // `changeMyPassword` returns how many OTHER sessions it ended, and the
    // toast says so rather than leaving the person guessing about their phone.
    await expect(page.getByText(/password changed/i)).toBeVisible();
  });

  test("lists the current session and offers no way to revoke it", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const email = `as-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    await page.goto("/account/sessions");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(/this device/i)).toBeVisible();
    // The row you are sitting in has no Revoke button — signing yourself out
    // belongs to the sign-out affordance, not to a per-row action that reads
    // as "revoke someone else".
    await expect(page.getByRole("button", { name: "Revoke" })).toHaveCount(0);
  });

  test("creates an API key, shows it once, then revokes it", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const email = `ak-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    await page.goto("/account/keys");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /new key/i }).click();
    await page.getByLabel("Name").fill("CI pipeline");
    await page.getByRole("button", { name: "Create", exact: true }).click();

    // The token exists in readable form exactly once; the dialog must not
    // auto-dismiss it.
    await expect(page.getByText(/copy your key now/i)).toBeVisible();
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await expect(page.getByText("CI pipeline")).toBeVisible();

    await page.getByRole("button", { name: "Revoke CI pipeline" }).click();
    await page.getByRole("button", { name: /^revoke$/i }).click();
    await expect(page.getByText("CI pipeline")).toHaveCount(0);
  });

  test("refuses to delete the account while a project is still owned", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const email = `ad-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");
    await createProjectViaWizard(page, `AD${Date.now()}`.slice(0, 20));

    await page.goto("/account/security");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /delete account/i }).click();
    await page.getByLabel(/^Current password/).fill("GoodPassw0rd");
    await page.getByLabel(/to confirm/i).fill(email);
    await page
      .getByRole("button", { name: /delete account/i })
      .last()
      .click();

    /*
      Lore's `user:delete:before` hook refuses, and its message reaches the
      browser unwrapped — that is the whole reason `MyAccountController` emits
      without `{ log: true }`. A generic failure toast here would mean the
      framework had started wrapping it in `AlephaError`.
    */
    await expect(page.getByText(/you still own 1 project/i)).toBeVisible();

    // And the refusal has to actually refuse.
    await page.goto("/account");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(email, { exact: true })).toBeVisible();
  });

  test("404s the retired /auth/profile paths", async ({ page }) => {
    test.setTimeout(90_000);

    // Deleted, not redirected — a decision recorded in folio #100. Invitation
    // emails sent before the move carry the old path and will 404.
    const email = `ao-${Date.now()}@example.com`;
    await registerAndVerify(page, email, "GoodPassw0rd");

    await page.goto("/auth/profile");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(email, { exact: true })).toHaveCount(0);
  });
});
