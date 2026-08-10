import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type FullConfig, request } from "@playwright/test";
import { e2ePort } from "../../../playwright.port.ts";

// The same derivation `playwright.config.ts` uses, not a copy of its default.
// "Keep in sync" was doing the work here and did not: this read `E2E_PORT ??
// 3304` while the config had grown the per-worktree derivation, so in a linked
// worktree the server came up on 37xx and setup posted to 3304 — ECONNREFUSED
// before a single spec ran.
const port = e2ePort(3304);
const ADMIN_EMAIL = "admin@alepha.dev";
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "adminadmin";

/**
 * Registers the admin user once (idempotent — ignores 409 conflict) then
 * saves an authenticated browser storageState to `e2e/.admin-state.json`.
 *
 * Tests that need admin access opt in via `test.use({ storageState })`
 * — see admin.spec.ts. Public/anon tests stay on the default empty state.
 *
 * Realm has `verifyEmailRequired: true`, so registration completion needs
 * a code. In dev, alepha writes outgoing emails to `node_modules/.alepha/emails/`
 * via `LocalEmailProvider` — we read the most recent email for the admin
 * address and extract the 6-digit code from the HTML body.
 */
export default async function globalSetup(_config: FullConfig) {
  const baseURL = `http://localhost:${port}`;
  const ctx = await request.newContext({ baseURL });

  // `node_modules/.alepha/emails` is never cleaned, so previous runs leave
  // admin emails behind. Stamp the time before registering and only accept a
  // mail sent after it — otherwise the poll below returns a stale code from an
  // earlier run and `register/complete` rejects it.
  const registeredAt = new Date();

  const intent = await ctx.post("/api/users/register", {
    data: {
      username: ADMIN_USERNAME,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    },
  });

  if (intent.status() === 200) {
    const intentBody = await intent.json();
    const emailCode = intentBody.expectEmailVerification
      ? await readLatestEmailCode(ADMIN_EMAIL, { since: registeredAt })
      : undefined;

    const complete = await ctx.post("/api/users/register/complete", {
      data: { intentId: intentBody.intentId, emailCode },
    });
    if (complete.status() !== 200 && complete.status() !== 409) {
      const text = await complete.text();
      throw new Error(
        `Register complete failed (${complete.status()}): ${text}`,
      );
    }
  } else if (intent.status() !== 409) {
    const text = await intent.text();
    throw new Error(`Register failed (${intent.status()}): ${text}`);
  }

  const login = await ctx.post("/_auth/token?provider=credentials", {
    data: {
      username: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    },
  });
  if (login.status() !== 200) {
    const text = await login.text();
    throw new Error(`Login failed (${login.status()}): ${text}`);
  }

  await ctx.storageState({ path: "./e2e/.admin-state.json" });
  await ctx.dispose();
}

/**
 * Reads the most recent email written by `LocalEmailProvider` for the given
 * recipient and extracts the 6-digit verification code embedded in the HTML
 * body. Polls briefly because the verification job is queued.
 */
export async function readLatestEmailCode(
  recipient: string,
  options: { dir?: string; timeoutMs?: number; since?: Date } = {},
): Promise<string> {
  const dir = options.dir ?? "node_modules/.alepha/emails";
  const timeoutMs = options.timeoutMs ?? 10_000;
  const sinceMs = options.since?.getTime() ?? 0;
  const sanitized = recipient.replace(/[^a-zA-Z0-9@.-]/g, "_");
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const files = (await readdir(dir))
        .filter((f) => f.startsWith(`${sanitized},`) && f.endsWith(".eml.json"))
        .sort()
        .reverse();
      if (files[0]) {
        const raw = await readFile(join(dir, files[0]), "utf8");
        const { body, sentAt } = JSON.parse(raw) as {
          body: string;
          sentAt: string;
        };
        if (new Date(sentAt).getTime() >= sinceMs) {
          const match = body.match(/\b(\d{6})\b/);
          if (match) return match[1];
        }
      }
    } catch {
      // dir may not exist yet on first run
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `No verification email for ${recipient} arrived within ${timeoutMs}ms (looked in ${dir})`,
  );
}
