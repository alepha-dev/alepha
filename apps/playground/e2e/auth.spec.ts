import { expect, test } from "@playwright/test";
import { readLatestEmailCode } from "./global-setup.ts";

/**
 * Covers the four /auth/* pages wired in AppRouter against the playground
 * realm (registration on, reset password on, credentials provider on).
 *
 * Email-verification *completion* isn't exercised end-to-end because
 * verification codes are hashed in the DB and the playground has no peek
 * endpoint — we only assert the verification step renders when the realm
 * requires it. Today the realm has `verifyEmailRequired: false`, so register
 * lands the user directly.
 */

test.describe("/auth/login", () => {
  test("renders the credentials form + sign-up link", async ({ page }) => {
    await page.goto("/auth/login");
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Sign up", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Forgot password/ }),
    ).toBeVisible();
  });

  test("invalid credentials keep the user on the login page", async ({
    page,
  }) => {
    await page.goto("/auth/login");
    await page
      .getByRole("textbox", { name: /Username, email or phone/ })
      .fill("nobody@example.com");
    await page
      .getByRole("textbox", { name: "Password", exact: true })
      .fill("wrongwrongwrong");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    // Auth call is async; wait briefly then assert no redirect happened.
    await page.waitForTimeout(2_000);
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible();
  });
});

test.describe("/auth/register", () => {
  test("renders all required identity fields + submit", async ({ page }) => {
    await page.goto("/auth/register");
    await expect(
      page.getByRole("textbox", { name: "Email", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Password", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create account" }),
    ).toBeVisible();
  });

  test("happy path: register → verify email → land on home", async ({
    page,
  }) => {
    const email = `signup-${Date.now()}@example.com`;
    await page.goto("/auth/register");
    const emailField = page.getByRole("textbox", {
      name: "Email",
      exact: true,
    });
    await emailField.click();
    await emailField.fill(email);
    await emailField.press("Tab");
    await page
      .getByRole("textbox", { name: "Password", exact: true })
      .fill("password123");
    await page.getByRole("button", { name: "Create account" }).click();

    // Realm requires email verification — verification step renders.
    const codeInput = page.locator("#emailCode");
    await expect(codeInput).toBeVisible({ timeout: 10_000 });

    // Read the dev-mail file written by LocalEmailProvider and complete.
    const code = await readLatestEmailCode(email);
    await codeInput.fill(code);
    await page.getByRole("button", { name: /Complete registration/ }).click();

    await page.waitForURL(/^http:\/\/[^/]+\/$/, { timeout: 15_000 });
  });
});

test.describe("/auth/reset-password", () => {
  test("renders email field + send code button", async ({ page }) => {
    await page.goto("/auth/reset-password");
    await expect(
      page.getByRole("textbox", { name: "Email", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Send verification code/ }),
    ).toBeVisible();
  });

  test("submitting transitions to the code step", async ({ page }) => {
    await page.goto("/auth/reset-password");
    const email = page.getByRole("textbox", { name: "Email", exact: true });
    await email.click();
    await email.fill(`reset-${Date.now()}@example.com`);
    await email.press("Tab");
    await page.getByRole("button", { name: /Send verification code/ }).click();
    // Step 2: a code input + Continue button render
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("button", { name: /Resend code/ }),
    ).toBeVisible();
  });

  /**
   * UI-only walkthrough: email → code → password screen. Uses a fresh
   * unregistered email so the reset endpoint returns its silent-success
   * response (no email sent, no verification cooldown burned). The code step
   * → password step transition is purely client-side, so any 6-digit code
   * advances the UI. Backend completion is exercised by the alepha core unit
   * tests on `CredentialService`; we don't replay it here because a full
   * register-then-reset on the same email would burn the 90s verification
   * cooldown that protects the real flow.
   */
  test("UI step transitions: email → code → password", async ({ page }) => {
    const email = `resetui-${Date.now()}@example.com`;

    await page.goto("/auth/reset-password");
    const emailField = page.getByRole("textbox", {
      name: "Email",
      exact: true,
    });
    await emailField.click();
    await emailField.fill(email);
    await emailField.press("Tab");
    await page.getByRole("button", { name: /Send verification code/ }).click();

    // Code step renders (no real email sent — unknown user → silent 200).
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible({
      timeout: 15_000,
    });
    await page.locator("#code").fill("123456");
    await page.getByRole("button", { name: "Continue" }).click();

    // Password step renders.
    await expect(
      page.getByRole("button", { name: /Set new password/ }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("textbox", { name: "New password", exact: true }),
    ).toBeVisible();
  });
});

test.describe("/auth/verify-email", () => {
  test("invalid link shows error state", async ({ page }) => {
    await page.goto("/auth/verify-email");
    // No email/token query params → component reports "Invalid link"
    await expect(page.getByText(/invalid/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
