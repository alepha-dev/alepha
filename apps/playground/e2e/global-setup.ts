import { type FullConfig, request } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 5174);
const ADMIN_EMAIL = "admin@alepha.dev";
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "adminadmin";

/**
 * Registers the admin user once (idempotent — ignores 409 conflict) then
 * saves an authenticated browser storageState to `e2e/.admin-state.json`.
 *
 * Tests that need admin access opt in via `test.use({ storageState })`
 * — see admin.spec.ts. Public/anon tests stay on the default empty state.
 */
export default async function globalSetup(_config: FullConfig) {
  const baseURL = `http://localhost:${port}`;
  const ctx = await request.newContext({ baseURL });

  // Register admin (intent + complete). Conflict is fine — admin already exists.
  const intent = await ctx.post("/api/users/register", {
    data: {
      username: ADMIN_USERNAME,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    },
  });

  if (intent.status() === 200) {
    const intentBody = await intent.json();
    const complete = await ctx.post("/api/users/register/complete", {
      data: { intentId: intentBody.intentId },
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

  // Login via credentials provider.
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
