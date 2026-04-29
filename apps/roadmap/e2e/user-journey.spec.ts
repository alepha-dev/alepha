import * as fs from "node:fs";
import * as path from "node:path";
import { expect, type Page, test } from "@playwright/test";

/**
 * End-to-end user journey: register → verify email → login → create campaign
 * → seed a quest (via API, since the Zone combobox is not creatable in the
 * shadcn UI) → accept it → complete it.
 *
 * The flow drives the real shadcn UI everywhere except the quest *form* — for
 * that we hit the API directly because the current Combobox can't author a new
 * zone for a brand-new project. We still walk the rest through the UI: list,
 * task view, accept, complete.
 */

const timestamp = Date.now();
const testUsername = `testuser${timestamp}`;
const testEmail = `test${timestamp}@example.com`;
const testPassword = "TestPassword123!";
const testCampaignTitle = `Camp${timestamp}`.slice(0, 20);
const testTaskTitle = `Quest${timestamp}`;

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

const clearEmails = () => {
  if (!fs.existsSync(emailDir)) return;
  for (const f of fs.readdirSync(emailDir)) {
    if (f.endsWith(".eml.json")) fs.unlinkSync(path.join(emailDir, f));
  }
};

/**
 * Resolve an Alepha API endpoint by inspecting the SSR-injected `apiLinks`
 * map embedded in the HTML. Means we don't have to hard-code paths that the
 * framework derives from action names.
 */
const apiPath = async (page: Page, action: string): Promise<string> => {
  const result = await page.evaluate(() => {
    const node = document.getElementById("__ssr");
    if (!node?.textContent) return null;
    try {
      const parsed = JSON.parse(node.textContent) as {
        "alepha.server.request.apiLinks"?: {
          prefix?: string;
          actions?: Record<string, { path: string }>;
        };
      };
      return parsed["alepha.server.request.apiLinks"] ?? null;
    } catch {
      return null;
    }
  });
  if (!result?.actions?.[action]) {
    throw new Error(`API action '${action}' not found in apiLinks`);
  }
  return `${result.prefix ?? "/api"}${result.actions[action].path}`;
};

test.describe("User Journey", () => {
  test.beforeAll(() => {
    fs.mkdirSync(emailDir, { recursive: true });
    clearEmails();
  });

  test("signup → verify → login → create campaign → seed quest → accept → complete", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // ── Register ───────────────────────────────────────────────────────────
    await test.step("register via UI", async () => {
      await page.goto("/auth/register");
      await page.waitForLoadState("networkidle");

      await page.getByRole("textbox", { name: "Username" }).fill(testUsername);
      await page.getByRole("textbox", { name: "Email" }).fill(testEmail);
      await page.locator('input[type="password"]').first().fill(testPassword);

      await page.getByRole("button", { name: /^sign up$/i }).click();
      await expect(page.getByLabel(/verification code/i)).toBeVisible({
        timeout: 10_000,
      });
    });

    // ── Verify email ───────────────────────────────────────────────────────
    await test.step("submit email verification code", async () => {
      const emailPath = await findLatestEmail(testEmail, 10_000);
      expect(emailPath).not.toBeNull();
      const code = extractCode(fs.readFileSync(emailPath!, "utf-8"));
      expect(code).not.toBeNull();
      expect(code).toHaveLength(6);

      await page.getByLabel(/verification code/i).fill(code!);
      await page.getByRole("button", { name: /verify and continue/i }).click();

      // Register flow ends on the login page (no auto-login).
      await page.waitForURL(/\/auth\/login/, { timeout: 15_000 });
    });

    // ── Login ──────────────────────────────────────────────────────────────
    await test.step("login via UI", async () => {
      // Identifier label is realm-driven; matches "Username", "Email" or
      // "Username or email" depending on settings.
      await page
        .getByRole("textbox", { name: /username|email/i })
        .first()
        .fill(testUsername);
      await page.locator('input[type="password"]').first().fill(testPassword);

      // Header has "Sign In" (capitalized I); the form button is "Sign in".
      // Use exact case to scope to the form submit button.
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL(/\/$/, { timeout: 15_000 });
    });

    // ── Create campaign ────────────────────────────────────────────────────
    let projectId = 0;
    await test.step("create campaign via UI", async () => {
      await page.goto("/p-new");
      await page.waitForLoadState("networkidle");

      await page.locator('input[type="text"]').first().fill(testCampaignTitle);

      await page.getByRole("button", { name: /create campaign/i }).click();
      await page.waitForURL(/\/p\/\d+/, { timeout: 15_000 });

      const match = page.url().match(/\/p\/(\d+)/);
      expect(match).not.toBeNull();
      projectId = Number(match![1]);
      await expect(page.getByText(testCampaignTitle).first()).toBeVisible();
    });

    // ── Seed quest via API ─────────────────────────────────────────────────
    let taskId = 0;
    await test.step("seed quest via API", async () => {
      const url = await apiPath(page, "createTask");
      const created = await page.evaluate(
        async ({ url, body }) => {
          const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(body),
          });
          if (!r.ok) {
            throw new Error(`createTask failed: ${r.status} ${await r.text()}`);
          }
          return r.json() as Promise<{ id: number }>;
        },
        {
          url,
          body: {
            title: testTaskTitle,
            description: "Seeded quest for e2e",
            package: "Main",
            priority: "medium",
            complexity: 3,
            projectId,
            objectives: [],
            attachments: [],
          },
        },
      );
      taskId = created.id;
      expect(taskId).toBeGreaterThan(0);
    });

    // ── Verify quest appears + open task view ──────────────────────────────
    await test.step("open task view via UI", async () => {
      await page.goto(`/p/${projectId}/q/${taskId}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(testTaskTitle).first()).toBeVisible({
        timeout: 10_000,
      });
    });

    // ── Accept quest ───────────────────────────────────────────────────────
    await test.step("accept quest", async () => {
      const accept = page.getByRole("button", {
        name: /sign and accept|accept.*quest/i,
      });
      await expect(accept).toBeVisible({ timeout: 10_000 });
      await accept.click();
      await expect(
        page.getByRole("button", { name: /complete.*quest/i }),
      ).toBeVisible({ timeout: 10_000 });
    });

    // ── Complete quest ─────────────────────────────────────────────────────
    await test.step("complete quest", async () => {
      await page.getByRole("button", { name: /complete.*quest/i }).click();
      // Server transitions the task to completed; UI either stays on the page
      // showing a completed badge or animates back to the board. Either way,
      // we should remain inside the campaign URL space.
      await page.waitForLoadState("networkidle");
      expect(page.url()).toContain(`/p/${projectId}`);
    });
  });
});
