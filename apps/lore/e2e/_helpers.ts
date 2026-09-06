import * as fs from "node:fs";
import * as path from "node:path";

import { type Browser, expect, type Page } from "@playwright/test";

/**
 * Where the running instance writes mail.
 *
 * A getter rather than a constant because each Playwright worker now boots its
 * own Lore on its own `DATA_DIR` (see `_fixtures.ts`). A shared constant would
 * have every worker reading every other worker's verification codes, which is
 * the one thing that makes per-worker isolation pointless.
 *
 * Falls back to the framework's default `DATA_DIR` so a run without the
 * fixture, or a helper used outside one, behaves as it always did.
 */
export const emailDirOf = (): string =>
  process.env.LORE_E2E_DATA_DIR
    ? path.join(process.env.LORE_E2E_DATA_DIR, "emails")
    : path.join(process.cwd(), "node_modules/.alepha/emails");

/**
 * Poll the dev-mail directory for the most recent message addressed to `email`.
 * The local email provider writes one JSON file per email; we sort by mtime so
 * concurrent tests don't get tripped by earlier-but-renamed siblings.
 */
export const findLatestEmail = async (
  email: string,
  maxWaitMs = 5_000,
  since?: number,
): Promise<string | null> => {
  const start = Date.now();
  const sanitized = email.replace(/[^a-zA-Z0-9@.-]/g, "_");
  // 1s of slack: file mtimes are coarser than `Date.now()` on some
  // filesystems, so an email written moments after `since` can carry a
  // timestamp a hair before it.
  const floor = since === undefined ? 0 : since - 1_000;
  while (Date.now() - start < maxWaitMs) {
    const dir = emailDirOf();
    if (fs.existsSync(dir)) {
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.startsWith(sanitized) && f.endsWith(".eml.json"))
        .map((f) => ({
          path: path.join(dir, f),
          mtime: fs.statSync(path.join(dir, f)).mtime.getTime(),
        }))
        .filter((f) => f.mtime >= floor)
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
 * Pull the invite link out of the HTML body of a dev invitation email.
 *
 * Returns the PATH, not the absolute URL: `PUBLIC_URL` is unset under
 * `yarn start`, so the mail builds a root-relative address and the spec has
 * to navigate against `baseURL` anyway.
 */
export const extractInviteUrl = (json: string): string | null => {
  const body = JSON.parse(json).body as string;
  const m = body.match(/href="([^"]*\/auth\/register\?invitation=[^"]+)"/i);
  return m ? m[1].replace(/&amp;/g, "&") : null;
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
 * per-quest modules (`questReminder`, `questChrono`) are
 * plain owner-controlled switches now, so the e2e just flips the flag.
 */
export type CapabilityKey = "work" | "knowledge" | "apps" | "support";

/**
 * Turn one of a project's capabilities on or off, and set its options.
 *
 * ⚠️ **Options are sent WHOLE and replace what was stored**, which is why this
 * reads the project back first: a spec turning one option on must not clear
 * the others by omitting them. The rule is the write path's, and the same one
 * `kanbanColumnConfig` and `tagColors` already follow - omitting a key is how
 * it is cleared, and a server-side merge cannot express that.
 *
 * Replaced `setProjectFeature`, which posted `{ features: { key: value } }` to
 * `updateProjectById`. That body no longer exists, and the 19 call sites were
 * rewritten rather than shimmed: a shim would have kept the old vocabulary
 * alive in the specs long after the thing it named was gone.
 */
export const setCapability = async (
  page: Page,
  projectId: number,
  key: CapabilityKey,
  over: { enabled?: boolean; options?: Record<string, boolean> } = {},
): Promise<void> => {
  const enabled = over.enabled ?? true;
  const url = `/api/projects/${projectId}/capabilities/${key}`;
  await page.evaluate(
    async ({ url, enabled, options, projectId, key }) => {
      let existing: Record<string, boolean> = {};
      if (enabled) {
        const read = await fetch(`/api/getProjectById/${projectId}`, {
          credentials: "include",
        });
        if (read.ok) {
          const project = (await read.json()) as {
            capabilities: Array<{
              key: string;
              options: Record<string, boolean>;
            }>;
          };
          existing =
            project.capabilities.find((it) => it.key === key)?.options ?? {};
        }
      }
      const r = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          enabled,
          options: { ...existing, ...options },
        }),
      });
      if (!r.ok) throw new Error(`setCapability ${r.status} ${await r.text()}`);
    },
    { url, enabled, options: over.options, projectId, key },
  );
};

/**
 * Add one sub-column to a project's Kanban band.
 *
 * A direct URL rather than `apiPost`, for the same reason
 * `setCapability` uses one: `apiPath` resolves an action to its declared
 * path, `:id` and all, and has nowhere to put the parameter.
 */
export const addKanbanColumn = async (
  page: Page,
  projectId: number,
  name: string,
): Promise<void> => {
  const url = `/api/addKanbanColumn/${projectId}`;
  await page.evaluate(
    async ({ url, name }) => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      if (!r.ok)
        throw new Error(`addKanbanColumn ${r.status} ${await r.text()}`);
    },
    { url, name },
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
  // Stamped before the submit so the poll below cannot pick up an email that
  // predates this registration. `emailDir` is a real directory that survives
  // the run, and the same address can be registered more than once across
  // runs - the fixed `ADMIN_EMAIL` always is. Without the floor, the poll
  // returns the previous run's message instantly and the spec dies on
  // "Email verification code has already been used", which reads like a
  // server bug rather than a stale file.
  const sentAfter = Date.now();
  await submit.click();
  await expect(
    page.getByRole("button", { name: /complete registration/i }),
  ).toBeVisible({ timeout: 10_000 });

  // The verification email is written by a fire-and-forget background job
  // (DirectJobDispatcher defers the send) that the register response does not
  // await — under CI contention the file can land several seconds after the
  // "complete registration" step renders. Poll generously so a slow-but-
  // arriving email doesn't read as a missing one.
  const emailPath = await findLatestEmail(email, 20_000, sentAfter);
  expect(emailPath).not.toBeNull();
  const code = extractCode(fs.readFileSync(emailPath!, "utf-8"));
  expect(code).not.toBeNull();
  expect(code).toHaveLength(6);

  await page.locator("#emailCode").fill(code!);
  await page.getByRole("button", { name: /complete registration/i }).click();
  await page.waitForURL(/^http:\/\/[^/]+\/$/, { timeout: 15_000 });
};

/**
 * Fill and submit the sign-in form. Resolves `true` when it lands on the
 * home page, `false` when it does not - a wrong password, or an account that
 * does not exist yet.
 */
export const signIn = async (
  page: Page,
  email: string,
  password: string,
  timeout = 15_000,
): Promise<boolean> => {
  await page.goto("/auth/login");
  await page.waitForLoadState("domcontentloaded");

  const identifier = page
    .getByRole("textbox", { name: /identifier|email/i })
    .first();
  const secret = page.getByRole("textbox", { name: /password/i }).first();

  // Re-filled under `toPass` for the same reason `registerAndVerify` does it:
  // the page is server-rendered and React hydrates after first paint, so a
  // value typed into the pre-hydration DOM is discarded when the form model
  // takes over. The submit then fails with "'password' is required" - which,
  // from a function that returns a boolean, is indistinguishable from a wrong
  // password, and made this report "no such account" for an account that
  // exists.
  await expect(async () => {
    await identifier.fill(email);
    await secret.fill(password);
    await expect(identifier).toHaveValue(email);
    await expect(secret).toHaveValue(password);
  }).toPass({ timeout: 15_000 });

  // Scoped to the form: the header carries its own "Sign In" button, and an
  // unscoped match is a strict-mode violation on any render showing both.
  await page
    .locator("form")
    .getByRole("button", { name: /sign in/i })
    .first()
    .click();
  try {
    await page.waitForURL(/^http:\/\/[^/]+\/$/, { timeout });
    return true;
  } catch {
    return false;
  }
};

/**
 * The realm admin, shared by every spec that needs one.
 *
 * It **cannot be made per-spec**: `playwright.config.ts` passes exactly one
 * `ADMIN_EMAIL` to the server, and `AppSecurityProvider` turns that single
 * address into `adminEmails`, so it is the only account the realm ever
 * promotes. `playwright.config.ts` reads these same constants, so the address
 * the server promotes and the address the specs sign in as cannot drift.
 */
export const ADMIN_EMAIL = "admin@example.com";
export const ADMIN_PASSWORD = "GoodPassw0rd";

/**
 * Sign in as the realm admin.
 *
 * The account is registered once by `global-setup.ts`, before any spec runs,
 * so this only ever signs in - and a failure here is a real failure rather
 * than "some other spec had not created it yet".
 *
 * Registering it per-spec is what reddened CI the moment
 * `admin-user-detail.spec.ts` was un-skipped and stopped being the only admin
 * spec: it and `admin-analytics.spec.ts` both called `registerAndVerify` with
 * the shared address against one server and one in-memory database, so
 * whichever ran second died on "Email verification code has already been
 * used" - in setup, on line 45, which reads like a broken fixture rather than
 * a collision with a file it never mentions.
 *
 * Registering it lazily instead ("sign in, and register if that fails") was
 * tried and rejected: it makes a slow or mis-hydrated login indistinguishable
 * from a missing account, so a false negative silently becomes a duplicate
 * registration and the same error comes back.
 */
export const signInAsAdmin = async (page: Page): Promise<void> => {
  expect(await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD), "admin sign-in").toBe(
    true,
  );
};

/**
 * Drive the 3-step project-create wizard: name → logo (skip) → modules →
 * submit. Keeps the module defaults (folios + kanban + releases on,
 * feedback off). Returns the new project id parsed from the URL.
 */
export interface WizardSetup {
  /**
   * Capabilities to end up with, on top of the wizard's own defaults.
   *
   * ⚠️ **Applied AFTER the wizard, through `setCapability`.** A spec that
   * needs Apps is not testing the wizard's Apps checkbox - `project-wizard`
   * is - and driving four checkboxes and a second step from 29 call sites
   * would make every one of them a wizard test that happens to be about
   * something else.
   */
  capabilities?: CapabilityKey[];
  /**
   * Per-capability options to turn on, e.g. `{ work: ["board"] }`.
   */
  options?: Partial<Record<CapabilityKey, string[]>>;
}

/**
 * Create a project the way a person does, then set up whatever the spec needs.
 *
 * ⚠️ **The wizard's own defaults are what a project gets here**, deliberately.
 * This helper used to promise "folios + kanban + releases on", which meant no
 * spec outside `project-wizard` ever exercised the real defaults - and made
 * every one of them silently depend on three switches it never mentioned. A
 * spec that needs the board or releases says so now, which is also the
 * documentation.
 */
export const createProjectViaWizard = async (
  page: Page,
  title: string,
  setup: WizardSetup = {},
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

  const slug = new URL(page.url()).pathname.split("/").find(Boolean);
  expect(slug).toBeTruthy();

  // Both identities, because callers need both: every URL takes the slug,
  // while `setCapability`, `apiPost` and the rest of the HTTP API still
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

  for (const key of setup.capabilities ?? []) {
    await setCapability(page, project.id, key, {
      options: Object.fromEntries(
        (setup.options?.[key] ?? []).map((option) => [option, true]),
      ),
    });
  }
  for (const [key, options] of Object.entries(setup.options ?? {})) {
    if ((setup.capabilities ?? []).includes(key as CapabilityKey)) continue;
    await setCapability(page, project.id, key as CapabilityKey, {
      options: Object.fromEntries(options.map((option) => [option, true])),
    });
  }

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
