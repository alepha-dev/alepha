import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity, CryptoProvider } from "alepha/security";
import { BadRequestError } from "alepha/server";
import { describe, it } from "vitest";

import {
  AlephaApiUsers,
  MyPasswordController,
  RealmProvider,
  SessionService,
  UserService,
} from "../index.ts";

const PASSWORD = "correct-horse-battery";

const setup = async (username: string) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiUsers);
  await alepha.start();

  const realmProvider = alepha.inject(RealmProvider);
  // Username sign-in: the realm this is most needed in has no email at all —
  // an infrastructure panel, an internal tool — so that is what the tests
  // exercise.
  realmProvider.register("default", {
    settings: { username: "required" } as never,
  });
  const userService = alepha.inject(UserService);
  const crypto = alepha.inject(CryptoProvider);

  // Wiped between cases. The realm's Postgres is shared across runs, and a
  // leftover user with the same name — from an earlier failed run — is found
  // by login before the one this test just created, which then looks like a
  // missing identity.
  await realmProvider.userRepository().deleteMany({});
  const dateTime = alepha.inject(DateTimeProvider);

  const user = await userService.users().create({ username });
  await realmProvider.identityRepository().create({
    provider: "credentials",
    userId: user.id,
    password: await crypto.hashPassword(PASSWORD),
  });

  // Two sessions: the one the caller is using, and one standing in for another
  // device.
  const sessions = realmProvider.sessionRepository();
  const expiresAt = dateTime.now().add(7, "days").toISOString();
  const current = await sessions.create({
    userId: user.id,
    refreshToken: crypto.randomUUID(),
    expiresAt,
  });
  await sessions.create({
    userId: user.id,
    refreshToken: crypto.randomUUID(),
    expiresAt,
  });

  return {
    controller: alepha.inject(MyPasswordController),
    sessionService: alepha.inject(SessionService),
    realmProvider,
    user,
    caller: { id: user.id, realm: "default", sessionId: current.id },
  };
};

const change = (
  ctx: Awaited<ReturnType<typeof setup>>,
  currentPassword: string,
  newPassword: string,
) =>
  ctx.controller.changeMyPassword(
    { body: { currentPassword, newPassword } },
    { user: ctx.caller as never },
  );

describe("alepha/api/users - MyPasswordController", () => {
  it("should change the password and let the new one sign in", async ({
    expect,
  }) => {
    const ctx = await setup("pw-happy");

    await change(ctx, PASSWORD, "a-brand-new-secret");

    const result = await ctx.sessionService.login(
      "credentials",
      "pw-happy",
      "a-brand-new-secret",
    );
    expect(result?.id).toBe(ctx.user.id);
  });

  it("should refuse a wrong current password", async ({ expect }) => {
    // The whole point of asking for it: someone who walked up to an unlocked
    // laptop must not be able to take the account over.
    const ctx = await setup("pw-wrong");

    await expect(
      change(ctx, "not-my-password", "whatever-else"),
    ).rejects.toThrowError(BadRequestError);
  });

  it("should leave the old password working when the change is refused", async ({
    expect,
  }) => {
    const ctx = await setup("pw-intact");

    await expect(
      change(ctx, "not-my-password", "whatever-else"),
    ).rejects.toThrow();

    const result = await ctx.sessionService.login(
      "credentials",
      "pw-intact",
      PASSWORD,
    );
    expect(result?.id).toBe(ctx.user.id);
  });

  it("should refuse reusing the same password", async ({ expect }) => {
    // Not security theatre: a change that changes nothing, accepted silently,
    // tells someone their account is now safe when it is not.
    const ctx = await setup("pw-same");

    await expect(change(ctx, PASSWORD, PASSWORD)).rejects.toThrowError(
      BadRequestError,
    );
  });

  it("should sign out every other session", async ({ expect }) => {
    /*
      The reason to change a password is usually the belief that somebody else
      has it. Leaving their session alive means the change accomplished
      nothing — they keep the access they already had, and the person who just
      changed it believes they are safe.
    */
    const ctx = await setup("pw-sessions");

    const res = await change(ctx, PASSWORD, "a-brand-new-secret");

    expect(res.otherSessionsRevoked).toBe(1);
    const remaining = await ctx.realmProvider
      .sessionRepository()
      .findMany({ where: { userId: { eq: ctx.user.id } } });
    expect(remaining.map((s) => s.id)).toEqual([ctx.caller.sessionId]);
  });

  it("should keep the caller's own session alive", async ({ expect }) => {
    // Securing an account must not also sign you out of the page you are
    // standing on.
    const ctx = await setup("pw-current");

    await change(ctx, PASSWORD, "a-brand-new-secret");

    const still = await ctx.realmProvider
      .sessionRepository()
      .findOne({ where: { id: { eq: ctx.caller.sessionId } } });
    expect(still).toBeTruthy();
  });

  it("should refuse when the account has no password at all", async ({
    expect,
  }) => {
    // An OAuth-only account. Setting a password here would create a second way
    // in that its owner never asked for.
    const ctx = await setup("pw-oauth-only");
    const identities = ctx.realmProvider.identityRepository();
    const existing = await identities.findOne({
      where: { userId: { eq: ctx.user.id } },
    });
    await identities.deleteById(existing!.id);

    await expect(change(ctx, PASSWORD, "anything-else")).rejects.toThrowError(
      BadRequestError,
    );
  });
});
