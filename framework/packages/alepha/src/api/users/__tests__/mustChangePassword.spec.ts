import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { AlephaSecurity, CryptoProvider } from "alepha/security";
import { describe, it } from "vitest";

import {
  AlephaApiUsers,
  credentialsMustChangePassword,
  MyIdentityController,
  MyPasswordController,
  RealmProvider,
  UserService,
} from "../index.ts";

const PASSWORD = "Correct-Horse-Battery-1";
const TEMPORARY = "Temporary-Pass-2";

/**
 * A temporary password (#Q3565): an admin sets it with `mustChangePassword`,
 * the user sees the mark on their own identities, and the first password
 * they choose themselves clears it.
 */
const setup = async (username: string) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(AlephaOrmTestPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiUsers);
  await alepha.start();

  const realmProvider = alepha.inject(RealmProvider);
  realmProvider.register("users", {
    settings: { username: "required" },
  });
  const userService = alepha.inject(UserService);
  const crypto = alepha.inject(CryptoProvider);
  await realmProvider.userRepository().deleteMany({});

  const user = await userService.users().create({ username });
  await realmProvider.identityRepository().create({
    provider: "credentials",
    userId: user.id,
    password: await crypto.hashPassword(PASSWORD),
  });

  const session = await realmProvider.sessionRepository().create({
    userId: user.id,
    refreshToken: crypto.randomUUID(),
    expiresAt: alepha
      .inject(DateTimeProvider)
      .now()
      .add(7, "days")
      .toISOString(),
  });

  const caller = { id: user.id, realm: "users", sessionId: session.id };
  const identities = alepha.inject(MyIdentityController);

  return {
    user,
    userService,
    passwords: alepha.inject(MyPasswordController),
    caller,
    /** The flag as the user's own browser reads it. */
    flag: async () => {
      const rows = await identities.listMyIdentities({}, { user: caller });
      return rows.find((row) => row.provider === "credentials")
        ?.mustChangePassword;
    },
    /** The flag as stored, read straight from the row. */
    stored: async () =>
      credentialsMustChangePassword(
        await realmProvider.identityRepository().findOne({
          where: { userId: { eq: user.id }, provider: { eq: "credentials" } },
        }),
      ),
  };
};

describe("alepha/api/users - temporary password", () => {
  it("should not mark a password nobody asked to change", async ({
    expect,
  }) => {
    const ctx = await setup("mcp-none");

    expect(await ctx.flag()).toBeUndefined();
    expect(await ctx.stored()).toBe(false);
  });

  it("should mark a password set with mustChangePassword", async ({
    expect,
  }) => {
    const ctx = await setup("mcp-set");

    await ctx.userService.setPassword(ctx.user.id, TEMPORARY, "users", {
      mustChangePassword: true,
    });

    expect(await ctx.flag()).toBe(true);
    expect(await ctx.stored()).toBe(true);
  });

  it("should clear the mark when the user changes their password", async ({
    expect,
  }) => {
    const ctx = await setup("mcp-change");
    await ctx.userService.setPassword(ctx.user.id, TEMPORARY, "users", {
      mustChangePassword: true,
    });

    await ctx.passwords.changeMyPassword(
      {
        body: {
          currentPassword: TEMPORARY,
          newPassword: "Chosen-By-The-User-3",
        },
      },
      { user: ctx.caller },
    );

    expect(await ctx.flag()).toBeUndefined();
    expect(await ctx.stored()).toBe(false);
  });

  it("should clear the mark when a password is set without it", async ({
    expect,
  }) => {
    // An admin setting a normal password over a temporary one: the default is
    // "not temporary", so no earlier mark survives a later set.
    const ctx = await setup("mcp-reset");
    await ctx.userService.setPassword(ctx.user.id, TEMPORARY, "users", {
      mustChangePassword: true,
    });

    await ctx.userService.setPassword(ctx.user.id, PASSWORD, "users");

    expect(await ctx.stored()).toBe(false);
  });
});
