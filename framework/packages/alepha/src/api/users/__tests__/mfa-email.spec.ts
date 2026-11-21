import { Alepha, AlephaError } from "alepha";
import { AlephaApiVerification } from "alepha/api/verifications";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { describe, expect, it } from "vitest";

import {
  AlephaApiUsers,
  MfaService,
  RealmProvider,
  UserNotifications,
  UserService,
} from "../index.ts";

const setup = async (user: { email?: string; emailVerified?: boolean }) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });

  alepha.with(AlephaOrmTestPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiVerification);
  alepha.with(AlephaApiUsers);
  alepha.with(UserNotifications);

  await alepha.start();

  const realmProvider = alepha.inject(RealmProvider);
  realmProvider.register("users", {
    features: { notifications: true },
    settings: { mfa: { emailCode: "required" } } as never,
  });

  const emailProvider = alepha.inject(MemoryEmailProvider);
  emailProvider.records = [];

  await realmProvider.userRepository().deleteMany({});

  const created = await alepha
    .inject(UserService)
    .users()
    .create({
      username: `mfa-mail-${Math.floor(Math.random() * 1e9)}`,
      ...user,
    });

  return {
    mfa: alepha.inject(MfaService),
    emailProvider,
    user: created,
  };
};

/**
 * The emailed code, read back out of what the memory mailer captured.
 *
 * Polled: notifications go through the job queue, whose first direct attempt
 * can lose a race with the schema and get picked up by the retry sweep.
 */
const sentCode = async (emailProvider: { records: any[] }): Promise<string> => {
  await expect.poll(() => emailProvider.records.length).toBeGreaterThan(0);

  const body = String(emailProvider.records[0].body ?? "");
  const match = body.match(/(\d{6})/);
  if (!match) {
    throw new AlephaError("No code found in the email that was sent");
  }
  return match[1]!;
};

describe("alepha/api/users - email code as a second factor", () => {
  it("should offer the email method to a user with a verified address", async ({
    expect,
  }) => {
    const ctx = await setup({
      email: "ada@example.com",
      emailVerified: true,
    });

    expect(await ctx.mfa.methodsFor(ctx.user.id, "users")).toEqual([
      "emailCode",
    ]);
  });

  it("should not offer it to a user whose address is unverified", async ({
    expect,
  }) => {
    const ctx = await setup({
      email: "ada@example.com",
      emailVerified: false,
    });

    // Challenging an unverified address would send the code to a mailbox
    // nobody has proved they own.
    expect(await ctx.mfa.methodsFor(ctx.user.id, "users")).toEqual([]);
  });

  it("should send a code and report a masked destination", async ({
    expect,
  }) => {
    const ctx = await setup({
      email: "ada@example.com",
      emailVerified: true,
    });

    const started = await ctx.mfa.start(ctx.user.id, "emailCode", "users");

    await expect.poll(() => ctx.emailProvider.records.length).toBe(1);
    // Masked: enough for the user to recognise the mailbox, not enough to
    // hand an attacker an address they did not already have.
    expect(started.sentTo).toBe("a**@example.com");
    expect(started.sentTo).not.toContain("ada@");
  });

  it("should accept the code that was emailed", async ({ expect }) => {
    const ctx = await setup({
      email: "ada@example.com",
      emailVerified: true,
    });
    await ctx.mfa.start(ctx.user.id, "emailCode", "users");

    const code = await sentCode(ctx.emailProvider);

    expect(await ctx.mfa.verify(ctx.user.id, "emailCode", code, "users")).toBe(
      true,
    );
  });

  it("should refuse a code that does not match", async ({ expect }) => {
    const ctx = await setup({
      email: "ada@example.com",
      emailVerified: true,
    });
    await ctx.mfa.start(ctx.user.id, "emailCode", "users");

    expect(
      await ctx.mfa.verify(ctx.user.id, "emailCode", "000000", "users"),
    ).toBe(false);
  });

  it("should refuse the emailed code a second time", async ({ expect }) => {
    const ctx = await setup({
      email: "ada@example.com",
      emailVerified: true,
    });
    await ctx.mfa.start(ctx.user.id, "emailCode", "users");
    const code = await sentCode(ctx.emailProvider);

    expect(await ctx.mfa.verify(ctx.user.id, "emailCode", code, "users")).toBe(
      true,
    );

    // `VerificationService.verifyCode` answers `{ ok: true, alreadyVerified }`
    // for a code it has already accepted, which is right for confirming an
    // address and wrong for a login factor: it would let one intercepted
    // code clear a second sign-in inside its lifetime.
    expect(await ctx.mfa.verify(ctx.user.id, "emailCode", code, "users")).toBe(
      false,
    );
  });
});
