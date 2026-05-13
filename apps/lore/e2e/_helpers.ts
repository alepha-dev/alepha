import * as fs from "node:fs";
import * as path from "node:path";
import { expect, type Page } from "@playwright/test";

export const emailDir = path.join(
  process.cwd(),
  "node_modules/.alepha/emails",
);

/**
 * Poll the dev-mail directory for the most recent message addressed to `email`.
 * The local email provider writes one JSON file per email; we sort by mtime so
 * concurrent tests don't get tripped by earlier-but-renamed siblings.
 */
export const findLatestEmail = async (
  email: string,
  maxWaitMs = 5_000,
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

/**
 * Pull the 6-character verification code out of the HTML body of a dev email.
 * Matches either the styled `letter-spacing` span or any 6-char span.
 */
export const extractCode = (json: string): string | null => {
  const body = JSON.parse(json).body as string;
  const m =
    body.match(/letter-spacing:\s*8px[^>]*>[\s\n]*([A-Z0-9]{6})[\s\n]*</i) ??
    body.match(/<span[^>]*>[\s\n]*([A-Z0-9]{6})[\s\n]*<\/span>/i);
  return m ? m[1] : null;
};

export const clearEmails = () => {
  if (!fs.existsSync(emailDir)) return;
  for (const f of fs.readdirSync(emailDir)) {
    if (f.endsWith(".eml.json")) fs.unlinkSync(path.join(emailDir, f));
  }
};

/**
 * Resolve an Alepha API endpoint by inspecting the SSR-injected `apiLinks`
 * map embedded in the HTML. Avoids hard-coding paths the framework derives
 * from action names.
 */
export const apiPath = async (page: Page, action: string): Promise<string> => {
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

export const apiPost = async <T>(
  page: Page,
  action: string,
  body: unknown,
): Promise<T> => {
  const url = await apiPath(page, action);
  return (await page.evaluate(
    async ({ url, body }) => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        throw new Error(`${r.status} ${await r.text()}`);
      }
      return r.json();
    },
    { url, body },
  )) as T;
};

/**
 * Register a fresh user through the UI, submit the email verification code
 * read from the dev-mail directory, and wait for auto-login to land on "/".
 */
export const registerAndVerify = async (
  page: Page,
  email: string,
  password: string,
) => {
  await page.goto("/auth/register");
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill(password);
  await page.getByRole("button", { name: /create account/i }).click();
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
  await page.waitForURL(/^http:\/\/[^/]+\/$/, { timeout: 15_000 });
};

/**
 * Drive the 3-step campaign-create wizard: name → skip logo → submit with
 * default visibility. Returns the new campaign id parsed from the URL.
 */
export const createCampaignViaWizard = async (
  page: Page,
  title: string,
): Promise<number> => {
  await page.goto("/new-campaign");
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="text"]').first().fill(title);
  await page.getByRole("button", { name: /^next$/i }).click();
  await page.getByRole("button", { name: /^skip$/i }).click();
  await page.getByRole("button", { name: /create campaign/i }).click();
  await page.waitForURL(/\/c\/\d+/, { timeout: 15_000 });
  const match = page.url().match(/\/c\/(\d+)/);
  expect(match).not.toBeNull();
  return Number(match![1]);
};
