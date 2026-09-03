import { readFileSync } from "node:fs";

import { expect, test } from "./_fixtures.ts";
import { extractCode, findLatestEmail } from "./_helpers.ts";

// No wipe of the dev-mail directory here: spec files run in parallel
// workers, and deleting every `.eml.json` used to race another file's
// registration between "submit" and "find the verification mail". Every
// lookup filters on its own unique address, so nothing needs clearing.

test.describe("Register", () => {
  test("schema-level minLength error is visible", async ({ page }) => {
    const ts = Date.now();
    await page.goto("/auth/register");
    // `networkidle` never settles once Turnstile is loaded — its widget polls.
    await page.waitForLoadState("domcontentloaded");

    await page
      .getByRole("textbox", { name: "Email", exact: true })
      .fill(`u${ts}@example.com`);
    await page
      .getByRole("textbox", { name: "Password", exact: true })
      .fill("Ab1!");

    // Test site key auto-passes but the submit stays disabled until the
    // Turnstile callback fires — same gate every other create-account click uses.
    const submit = page.getByRole("button", { name: /create account/i });
    await expect(submit).toBeEnabled({ timeout: 30_000 });
    await submit.click();

    await expect(
      page.getByText(/8 characters|fewer than 8/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("registers, verifies email, lands logged-in on home", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ts = Date.now();
    const email = `usr${ts}@example.com`;
    const password = "GoodPassw0rd";

    await page.goto("/auth/register");
    // `networkidle` never settles once Turnstile is loaded — its widget polls.
    await page.waitForLoadState("domcontentloaded");

    await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await page
      .getByRole("textbox", { name: "Password", exact: true })
      .fill(password);

    // Captcha container is rendered iff the realm exposes a site key.
    await expect(page.getByTestId("captcha")).toBeVisible({ timeout: 5_000 });
    // Test site key (`1x...AA`) auto-passes, so Turnstile fires its callback
    // and the gated submit button becomes enabled.
    const submit = page.getByRole("button", { name: /create account/i });
    await expect(submit).toBeEnabled({ timeout: 30_000 });
    await submit.click();

    // Verification phase — InputOTP renders 6 slot inputs.
    await expect(
      page.getByRole("button", { name: /complete registration/i }),
    ).toBeVisible({ timeout: 10_000 });

    const emailPath = await findLatestEmail(email, 10_000);
    expect(emailPath).not.toBeNull();
    const code = extractCode(readFileSync(emailPath!, "utf-8"));
    expect(code).not.toBeNull();
    expect(code).toHaveLength(6);

    // InputOTP exposes the underlying 6-digit input via name=emailCode.
    const otp = page.locator("#emailCode");
    await otp.fill(code!);
    await page.getByRole("button", { name: /complete registration/i }).click();

    // Auto-login — lands on "/" (no manual login step).
    await page.waitForURL(/^http:\/\/[^/]+\/$/, { timeout: 15_000 });
  });

  test("?intent=createProject shows banner and lands on /new-project after signup", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ts = Date.now();
    const email = `intent${ts}@example.com`;
    const password = "GoodPassw0rd";

    await page.goto("/auth/register?intent=createProject");
    // `networkidle` never settles once Turnstile is loaded — its widget polls.
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByText(/before creating a project, create an account/i),
    ).toBeVisible({ timeout: 5_000 });

    await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await page
      .getByRole("textbox", { name: "Password", exact: true })
      .fill(password);

    await expect(page.getByTestId("captcha")).toBeVisible({ timeout: 5_000 });
    const submit = page.getByRole("button", { name: /create account/i });
    await expect(submit).toBeEnabled({ timeout: 30_000 });
    await submit.click();

    await expect(
      page.getByRole("button", { name: /complete registration/i }),
    ).toBeVisible({ timeout: 10_000 });

    const emailPath = await findLatestEmail(email, 10_000);
    expect(emailPath).not.toBeNull();
    const code = extractCode(readFileSync(emailPath!, "utf-8"));
    expect(code).not.toBeNull();
    expect(code).toHaveLength(6);

    await page.locator("#emailCode").fill(code!);
    await page.getByRole("button", { name: /complete registration/i }).click();

    // Post-register redirect via ?r= → / ?action=createProject → Home pushes to projectCreate.
    await page.waitForURL(/\/new-project(\?|$)/, { timeout: 15_000 });
  });
});
