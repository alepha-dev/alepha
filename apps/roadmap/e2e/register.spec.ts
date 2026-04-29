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
  test("client-side password policy errors are visible", async ({ page }) => {
    const ts = Date.now();
    await page.goto("/auth/register");
    await page.waitForLoadState("networkidle");

    await page.getByRole("textbox", { name: "Username" }).fill(`u${ts}`);
    await page
      .getByRole("textbox", { name: "Email" })
      .fill(`u${ts}@example.com`);
    const password = page.locator('input[type="password"]').first();
    const submit = page.getByRole("button", { name: /^sign up$/i });

    // missing uppercase
    await password.fill("lowercase1");
    await submit.click();
    await expect(page.getByText(/uppercase letter/i)).toBeVisible({
      timeout: 5000,
    });

    // missing number
    await password.fill("NoDigitsHere");
    await submit.click();
    await expect(page.getByText(/number/i)).toBeVisible({ timeout: 5000 });

    // too short — schema-level minLength check
    await password.fill("Ab1!");
    await submit.click();
    await expect(
      page.getByText(/8 characters|fewer than 8/i).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test("registers successfully and verifies email", async ({ page }) => {
    test.setTimeout(60000);
    const ts = Date.now();
    const username = `usr${ts}`;
    const email = `usr${ts}@example.com`;
    const password = "GoodPassw0rd";

    await page.goto("/auth/register");
    await page.waitForLoadState("networkidle");

    await page.getByRole("textbox", { name: "Username" }).fill(username);
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.getByRole("button", { name: /^sign up$/i }).click();

    // verification phase
    await expect(page.getByLabel(/verification code/i)).toBeVisible({
      timeout: 10000,
    });

    const emailPath = await findLatestEmail(email, 10000);
    expect(emailPath).not.toBeNull();
    const code = extractCode(fs.readFileSync(emailPath!, "utf-8"));
    expect(code).not.toBeNull();
    expect(code).toHaveLength(6);

    await page.getByLabel(/verification code/i).fill(code!);
    await page.getByRole("button", { name: /verify and continue/i }).click();

    // After verification the page redirects to the login form.
    await page.waitForURL(/\/auth\/login/, { timeout: 15000 });
  });
});
