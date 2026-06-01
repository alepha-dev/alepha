import { Alepha, t } from "alepha";
import { oauthOptions } from "alepha/api/oauth";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer, NodeHttpServerProvider } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { IdentityController } from "../src/api/controllers/IdentityController.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";

/**
 * Regression coverage for the `/me` "Set Password" flow
 * (`IdentityController.setPassword`).
 *
 * The bug: the controller used to write a `usernamePassword` identity with the
 * hash nested under `providerData.password`. But the realm's credentials
 * provider is named `credentials`, and login reads the top-level `password`
 * column — so the password set from `/me` was inert and the user could never
 * sign in with it ("nothing happens"). Admin's `/admin/users/:id` worked
 * because it delegates to the framework's `UserService.setPassword`.
 *
 * These tests pin the contract that matters: after setting a password from
 * `/me`, the account can actually authenticate through the real token grant.
 */

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = t.object({
  username: t.string(),
  email: t.email(),
});

interface TestContext {
  alepha: Alepha;
  baseUrl: string;
  adminUserController: AdminUserController;
  identityController: IdentityController;
  fakeProvider: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(AlephaMcp);

  alepha.set(oauthOptions, {
    realm: "default",
    resource: "/mcp",
    loginPath: "/auth/login",
  });

  alepha.with(LoreApi);
  alepha.with(LoreMcp);

  await alepha.start();

  const server = alepha.inject(NodeHttpServerProvider);

  return {
    alepha,
    baseUrl: server.hostname,
    adminUserController: alepha.inject(AdminUserController),
    identityController: alepha.inject(IdentityController),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

/**
 * Create a fresh account with NO credentials identity — the OAuth-only shape
 * that motivates the `/me` "Set Password" feature in the first place.
 */
const createCredentialslessUser = async (ctx: TestContext) => {
  const fake = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fake, roles: ["user"] } },
    { user: adminUser },
  );
  // The real `$secure`-resolved token carries the email; mirror that so the
  // handler can use it as the credentials identifier.
  return {
    user: {
      id: response.data.id,
      roles: response.data.roles,
      email: fake.email,
    },
    email: fake.email,
  };
};

/**
 * Attempt a password grant through the real `/_auth/token` endpoint, exactly
 * as the browser login form does.
 */
const login = async (baseUrl: string, email: string, password: string) => {
  return fetch(`${baseUrl}/_auth/token?provider=credentials`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: email, password }),
  });
};

describe("IdentityController.setPassword (/me)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("lets a credentials-less account sign in with the password it just set", async ({
    expect,
  }) => {
    const { user, email } = await createCredentialslessUser(ctx);
    const password = "Sup3rSecret!";

    // Baseline: no credentials identity yet → the password grant must fail.
    const before = await login(ctx.baseUrl, email, password);
    expect(before.ok).toBe(false);

    // Set the password from the profile page.
    const res = await ctx.identityController.setPassword.run(
      { body: { password } },
      { user },
    );
    expect(res.success).toBe(true);

    // A "credentials" identity (the one login reads) must now exist — NOT a
    // dangling "usernamePassword" row.
    const identities = await ctx.identityController.getMyIdentities.run(
      {},
      { user },
    );
    expect(identities.some((i) => i.provider === "credentials")).toBe(true);
    expect(identities.some((i) => i.provider === "usernamePassword")).toBe(
      false,
    );

    // The whole point: the account can now authenticate for real.
    const after = await login(ctx.baseUrl, email, password);
    expect(after.status).toBe(200);
    const body = (await after.json()) as { user?: { id?: string } };
    expect(body.user?.id).toBe(user.id);
  });

  it("rejects a second set-password once a credentials identity exists", async ({
    expect,
  }) => {
    const { user } = await createCredentialslessUser(ctx);

    await ctx.identityController.setPassword.run(
      { body: { password: "Sup3rSecret!" } },
      { user },
    );

    await expect(
      ctx.identityController.setPassword.run(
        { body: { password: "An0therOne!" } },
        { user },
      ),
    ).rejects.toThrow();
  });
});
