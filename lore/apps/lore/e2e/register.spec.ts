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
    await page.waitForLoadState("networkidle");

    await page
      .getByRole("textbox", { name: "Email", exact: true })
      .fill(`u${ts}@example.com`);
    await page
      .getByRole("textbox", { name: "Password", exact: true })
      .fill("Ab1!");
    await page.getByRole("button", { name: /create account/i }).click();

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
    await page.waitForLoadState("networkidle");

    await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
    await page
      .getByRole("textbox", { name: "Password", exact: true })
      .fill(password);
    await page.getByRole("button", { name: /create account/i }).click();

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
});
