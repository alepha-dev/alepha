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
 * Turn a project feature toggle on (or off) from within an e2e flow.
 *
 * Replaces the old `unlockShopFeature`, which had to farm gold from a
 * throwaway quest and POST a purchase. The gold Shop is gone — the
 * per-quest modules (`questNote`, `questReminder`, `questChrono`) are
 * plain owner-controlled switches now, so the e2e just flips the flag.
 */
export const setProjectFeature = async (
  page: Page,
  projectId: number,
  featureKey: string,
  value = true,
): Promise<void> => {
  // Action routes are name-derived: `/api/<actionName>/<param>` (same
  // shape as the acceptQuest / completeQuest URLs used above).
  const url = `/api/updateProjectById/${projectId}`;
  await page.evaluate(
    async ({ url, featureKey, value }) => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ features: { [featureKey]: value } }),
      });
      if (!r.ok)
        throw new Error(`setProjectFeature ${r.status} ${await r.text()}`);
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

  const emailField = page.getByRole("textbox", { name: "Email", exact: true });
  const passwordField = page.getByRole("textbox", {
    name: "Password",
    exact: true,
  });

  // Filled under `toPass` because the page is server-rendered and React
  // hydrates after first paint: a value typed into the pre-hydration DOM is
  // discarded when the form model takes over, and the only evidence is the
  // submit failing with "'password' is required" — which reads like a bad
  // fixture rather than a race. Re-filling until the values stick is the fix;
  // a bare `fill` is actionability-aware but knows nothing about hydration.
  await expect(async () => {
    await emailField.fill(email);
    await passwordField.fill(password);
    await expect(emailField).toHaveValue(email);
    await expect(passwordField).toHaveValue(password);
  }).toPass({ timeout: 15_000 });
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
 * Drive the 3-step project-create wizard: name → logo (skip) → modules →
 * submit. Keeps the module defaults (folios + kanban + milestones on,
 * feedback off). Returns the new project id parsed from the URL.
 */
export const createProjectViaWizard = async (
  page: Page,
  title: string,
): Promise<{ id: number; slug: string }> => {
  await page.goto("/new-project");
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="text"]').first().fill(title);
  // Step 1 → Step 2 (logo)
  await page.getByRole("button", { name: /^next$/i }).click();
  // Step 2 → Step 3 (modules) — icon is optional, skip via Next
  await page.getByRole("button", { name: /^next$/i }).click();
  // Step 3 → submit
  await page.getByRole("button", { name: /create project/i }).click();

  // The wizard lands on `/<slug>` — a single root segment. Matched with a
  // predicate rather than a regex because `/new-project`, the page we are
  // leaving, is also a single root segment and would satisfy one immediately.
  await page.waitForURL(
    (url) =>
      url.pathname !== "/new-project" &&
      url.pathname.split("/").filter(Boolean).length === 1,
    { timeout: 15_000 },
  );

  const slug = new URL(page.url()).pathname.split("/").filter(Boolean)[0];
  expect(slug).toBeTruthy();

  // Both identities, because callers need both: every URL takes the slug,
  // while `setProjectFeature`, `apiPost` and the rest of the HTTP API still
  // take the integer id.
  const path = await apiPath(page, "getProjectBySlug");
  const project = await page.evaluate(
    async (url) => {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return r.json() as Promise<{ id: number }>;
    },
    path.replace(":slug", slug!),
  );

  return { id: project.id, slug: slug! };
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

/**
 * Type into the shared markdown editor.
 *
 * Two things changed when MDXEditor became a View/Edit toggle, and both
 * matter here:
 *
 * 1. **The editor is not mounted until Edit mode.** Folios open rendered
 *    (they are read far more than written), so this switches first — via
 *    the `data-testid` toggle the quest surfaces carry, falling back to ⌘E,
 *    which is what the folio workspace binds in its View menu.
 * 2. **`.fill()` still does not work.** CodeMirror's surface is a
 *    contenteditable like Lexical's was, so the text has to be typed. The
 *    select-all + Delete replaces `fill()`'s clearing behaviour.
 *
 * `nth` picks among several editors on screen (0-based).
 */
export async function fillMarkdownEditor(
  page: import("@playwright/test").Page,
  text: string,
  nth = 0,
): Promise<void> {
  const toggle = page.getByTestId("markdown-mode-toggle").nth(nth);
  if (await toggle.count()) {
    if ((await toggle.getAttribute("data-mode")) === "view") {
      await toggle.click();
    }
  } else {
    // The folio workspace drives the mode from its menubar, not an inline
    // button. ⌘E is the same action.
    const alreadyEditing = await page.locator(".lore-md-edit").count();
    if (!alreadyEditing) await page.keyboard.press("ControlOrMeta+e");
  }

  const editor = page.locator(".lore-md-edit .cm-content").nth(nth);
  await editor.waitFor({ state: "visible", timeout: 10_000 });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await editor.pressSequentially(text);
}
