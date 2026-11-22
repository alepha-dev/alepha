import { Alepha, AlephaError } from "alepha";
import { AlephaApiVerification } from "alepha/api/verifications";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { AlephaSecurity, CryptoProvider } from "alepha/security";
import { BadRequestError } from "alepha/server";
import { describe, it } from "vitest";

import {
  AlephaApiUsers,
  CredentialService,
  MyProfileController,
  RealmProvider,
  UserNotifications,
} from "../index.ts";

/**
 * A signed-in user verifies their own address (#Q4096): a code to the
 * address on file, typed back on the account page. And a completed password
 * reset proves the address too, since its code reached that mailbox.
 */
describe("alepha/api/users - verify my address", () => {
  const setup = async () => {
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
      settings: { resetPasswordAllowed: true },
    });
    const users = realmProvider.userRepository();
    // Letters only: the code is read as the mail's first six digits, and a
    // hex id can hold six in a row.
    const tag = crypto
      .randomUUID()
      .slice(0, 8)
      .replace(/\d/g, (digit) => "ghijklmnop"[Number(digit)]!);
    const user = await users.create({
      username: `me-${tag}`,
      email: `${tag}@example.com`,
      roles: ["user"],
      emailVerified: false,
    });
    const email = alepha.inject(MemoryEmailProvider);
    email.records = [];
    return {
      alepha,
      users,
      user,
      email,
      profile: alepha.inject(MyProfileController),
      caller: { id: user.id, realm: "users", sessionId: "s-1" },
    };
  };

  const codeIn = (body: string): string => {
    const match = body.match(/(\d{6})/);
    if (!match) throw new AlephaError("Code not found in email");
    return match[1]!;
  };

  it("sends a code to the caller's own address and verifies it", async ({
    expect,
  }) => {
    const ctx = await setup();

    await ctx.profile.requestMyEmailVerification({}, { user: ctx.caller });
    await expect.poll(() => ctx.email.records.length).toBe(1);
    expect(ctx.email.records[0]!.to).toBe(ctx.user.email);

    const profile = await ctx.profile.verifyMyEmail(
      { body: { code: codeIn(ctx.email.records[0]!.body) } },
      { user: ctx.caller },
    );
    expect(profile.emailVerified).toBe(true);
    expect(
      (await ctx.users.getOne({ where: { id: { eq: ctx.user.id } } }))
        .emailVerified,
    ).toBe(true);
  });

  it("refuses a wrong code and leaves the address unverified", async ({
    expect,
  }) => {
    const ctx = await setup();
    await ctx.profile.requestMyEmailVerification({}, { user: ctx.caller });
    await expect.poll(() => ctx.email.records.length).toBe(1);

    await expect(
      ctx.profile.verifyMyEmail(
        { body: { code: "000000" } },
        { user: ctx.caller },
      ),
    ).rejects.toThrow(BadRequestError);
    expect(
      (await ctx.users.getOne({ where: { id: { eq: ctx.user.id } } }))
        .emailVerified,
    ).toBe(false);
  });

  it("marks the address verified when a password reset completes", async ({
    expect,
  }) => {
    const ctx = await setup();
    const credentials = ctx.alepha.inject(CredentialService);
    await credentials.identities().create({
      userId: ctx.user.id,
      provider: "credentials",
      password: await ctx.alepha
        .inject(CryptoProvider)
        .hashPassword("OldPassword123!"),
    });

    const intent = await credentials.createPasswordResetIntent(ctx.user.email!);
    await expect.poll(() => ctx.email.records.length).toBe(1);
    await credentials.completePasswordReset({
      intentId: intent.intentId,
      code: codeIn(ctx.email.records[0]!.body),
      newPassword: "NewPassword456!",
    });

    expect(
      (await ctx.users.getOne({ where: { id: { eq: ctx.user.id } } }))
        .emailVerified,
    ).toBe(true);
  });
});
