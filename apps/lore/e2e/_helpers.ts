import * as fs from "node:fs";
import * as path from "node:path";
import { type Browser, expect, type Page } from "@playwright/test";

export const emailDir = path.join(process.cwd(), "node_modules/.alepha/emails");

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
 * Turn a campaign feature toggle on (or off) from within an e2e flow.
 *
 * Replaces the old `unlockShopFeature`, which had to farm gold from a
 * throwaway quest and POST a purchase. The gold Shop is gone — the
 * per-quest modules (`questNote`, `questReminder`, `questChrono`) are
 * plain owner-controlled switches now, so the e2e just flips the flag.
 */
export const setCampaignFeature = async (
  page: Page,
  campaignId: number,
  featureKey: string,
  value = true,
): Promise<void> => {
  // Action routes are name-derived: `/api/<actionName>/<param>` (same
  // shape as the acceptQuest / completeQuest URLs used above).
  const url = `/api/updateCampaignById/${campaignId}`;
  await page.evaluate(
    async ({ url, featureKey, value }) => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ features: { [featureKey]: value } }),
      });
      if (!r.ok)
        throw new Error(`setCampaignFeature ${r.status} ${await r.text()}`);
    },
    { url, featureKey, value },
  );
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
  // `networkidle` never settles once Turnstile is loaded — its widget polls.
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page
    .getByRole("textbox", { name: "Password", exact: true })
    .fill(password);
  // Captcha gate — test site key auto-solves but the submit button stays
  // disabled until Turnstile fires its callback.
  const submit = page.getByRole("button", { name: /create account/i });
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.click();
  await expect(
    page.getByRole("button", { name: /complete registration/i }),
  ).toBeVisible({ timeout: 10_000 });

  // The verification email is written by a fire-and-forget background job
  // (DirectJobDispatcher defers the send) that the register response does not
  // await — under CI contention the file can land several seconds after the
  // "complete registration" step renders. Poll generously so a slow-but-
  // arriving email doesn't read as a missing one.
  const emailPath = await findLatestEmail(email, 20_000);
  expect(emailPath).not.toBeNull();
  const code = extractCode(fs.readFileSync(emailPath!, "utf-8"));
  expect(code).not.toBeNull();
  expect(code).toHaveLength(6);

  await page.locator("#emailCode").fill(code!);
  await page.getByRole("button", { name: /complete registration/i }).click();
  await page.waitForURL(/^http:\/\/[^/]+\/$/, { timeout: 15_000 });
};

/**
 * Drive the 3-step campaign-create wizard: name → logo (skip) → modules →
 * submit. Keeps the module defaults (folios + kanban + chapters on,
 * petitions off). Returns the new campaign id parsed from the URL.
 */
export const createCampaignViaWizard = async (
  page: Page,
  title: string,
): Promise<number> => {
  await page.goto("/new-campaign");
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="text"]').first().fill(title);
  // Step 1 → Step 2 (logo)
  await page.getByRole("button", { name: /^next$/i }).click();
  // Step 2 → Step 3 (modules) — icon is optional, skip via Next
  await page.getByRole("button", { name: /^next$/i }).click();
  // Step 3 → submit
  await page.getByRole("button", { name: /create campaign/i }).click();
  await page.waitForURL(/\/c\/\d+/, { timeout: 15_000 });
  const match = page.url().match(/\/c\/(\d+)/);
  expect(match).not.toBeNull();
  return Number(match![1]);
};

/**
 * Open a fresh `BrowserContext` (isolated cookie jar) and register a new
 * user in it. Returns the context, its page, and the generated email.
 *
 * Tests that need two authenticated users at once (e.g. invitation flow:
 * inviter + invitee) call this once for the second user — the default
 * `page` fixture handles the first.
 *
 * The caller is responsible for `await ctx.close()` once finished.
 */
export const newUserContext = async (
  browser: Browser,
  baseURL: string,
  label: string,
): Promise<{
  ctx: Awaited<ReturnType<Browser["newContext"]>>;
  page: Page;
  email: string;
}> => {
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.com`;
  await registerAndVerify(page, email, "GoodPassw0rd");
  return { ctx, page, email };
};
