import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "@playwright/test";

const emailDir = path.join(process.cwd(), "node_modules/.alepha/emails");

const findLatestEmail = async (
  email: string,
  maxWaitMs = 5000,
): Promise<string | null> => {
  const start = Date.now();
  const sanitized = email.replace(/[^a-zA-Z0-9@.-]/g, "_");
  while (Date.now() - start < maxWaitMs) {
    if (fs.existsSync(emailDir)) {
      const files = fs
        .readdirSync(emailDir)
        .filter((f) => f.startsWith(sanitized) && f.endsWith(".eml.json"))
        .map((f) => ({
          path: path.join(emailDir, f),
          mtime: fs.statSync(path.join(emailDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.mtime - a.mtime);
      if (files.length > 0) return files[0].path;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
};

const extractCode = (json: string): string | null => {
  const body = JSON.parse(json).body as string;
  const m =
    body.match(/letter-spacing:\s*8px[^>]*>[\s\n]*([A-Z0-9]{6})[\s\n]*</i) ??
    body.match(/<span[^>]*>[\s\n]*([A-Z0-9]{6})[\s\n]*<\/span>/i);
  return m ? m[1] : null;
};

test.beforeAll(() => {
  fs.mkdirSync(emailDir, { recursive: true });
  for (const f of fs.readdirSync(emailDir)) {
    if (f.endsWith(".eml.json")) fs.unlinkSync(path.join(emailDir, f));
  }
});

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
    const code = extractCode(fs.readFileSync(emailPath!, "utf-8"));
    expect(code).not.toBeNull();
    expect(code).toHaveLength(6);

    // InputOTP exposes the underlying 6-digit input via name=emailCode.
    const otp = page.locator("#emailCode");
    await otp.fill(code!);
    await page.getByRole("button", { name: /complete registration/i }).click();

    // Auto-login — lands on "/" (no manual login step).
    await page.waitForURL(/^http:\/\/[^/]+\/$/, { timeout: 15_000 });
  });

  test("?intent=createCampaign shows banner and lands on /new-campaign after signup", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ts = Date.now();
    const email = `intent${ts}@example.com`;
    const password = "GoodPassw0rd";

    await page.goto("/auth/register?intent=createCampaign");
    // `networkidle` never settles once Turnstile is loaded — its widget polls.
    await page.waitForLoadState("domcontentloaded");

    await expect(
      page.getByText(/before creating a campaign, create an account/i),
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
    const code = extractCode(fs.readFileSync(emailPath!, "utf-8"));
    expect(code).not.toBeNull();
    expect(code).toHaveLength(6);

    await page.locator("#emailCode").fill(code!);
    await page.getByRole("button", { name: /complete registration/i }).click();

    // Post-register redirect via ?r= → / ?action=createCampaign → Home pushes to campaignCreate.
    await page.waitForURL(/\/new-campaign(\?|$)/, { timeout: 15_000 });
  });
});
