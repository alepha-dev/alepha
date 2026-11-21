import { Alepha, AlephaError } from "alepha";
import { AlephaApiVerification } from "alepha/api/verifications";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { describe, it } from "vitest";

import {
  AlephaApiUsers,
  RealmProvider,
  RegistrationService,
  UserNotifications,
  UserService,
} from "../index.ts";

const setup = async (realmSettings?: Record<string, unknown>) => {
  const alepha = Alepha.create();

  alepha.with(AlephaOrmTestPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiVerification);
  alepha.with(AlephaApiUsers);
  alepha.with(UserNotifications);

  await alepha.start();

  const emailProvider = alepha.inject(MemoryEmailProvider);
  emailProvider.records = [];

  const realmProvider = alepha.inject(RealmProvider);
  if (realmSettings) {
    realmProvider.register("users", {
      // Verification and the owner-warning both go out as notifications.
      features: { notifications: true },
      settings: realmSettings,
    });
  }

  return {
    alepha,
    registrationService: alepha.inject(RegistrationService),
    userService: alepha.inject(UserService),
    emailProvider,
    realmProvider,
  };
};

/**
 * Registering must never let a stranger learn whether an address is already
 * on file. The two modes differ:
 *
 * - verification ON  → answer exactly as if the address were new, and warn
 *   the real owner out of band.
 * - verification OFF → one generic conflict for every taken field, so the
 *   error cannot be used to single out the email.
 */
describe("alepha/api/users - registration enumeration", () => {
  describe("with email verification required", () => {
    const settings = { verifyEmailRequired: true, email: "required" };

    it("answers a second attempt inside the cooldown like the first, taken or fresh", async ({
      expect,
    }) => {
      // The fresh path creates a verification, and the verification service
      // rate-limits (90 s cooldown); the decoy path never did. Two POSTs for
      // the same address therefore told a stranger whether it was on file.
      const { registrationService, userService } = await setup(settings);

      await userService.users().create({
        username: "owner",
        email: "taken@example.com",
        roles: ["user"],
      });

      const body = (email: string) => ({
        email,
        password: "SecurePassword123!",
      });

      await registrationService.createRegistrationIntent(
        body("taken@example.com"),
      );
      await registrationService.createRegistrationIntent(
        body("taken@example.com"),
      );

      await registrationService.createRegistrationIntent(
        body("fresh@example.com"),
      );
      await expect(
        registrationService.createRegistrationIntent(body("fresh@example.com")),
      ).resolves.toBeDefined();
    });

    it("answers a taken email exactly like a fresh one", async ({ expect }) => {
      const { registrationService, userService } = await setup(settings);

      await userService.users().create({
        username: "owner",
        email: "taken@example.com",
        roles: ["user"],
      });

      const fresh = await registrationService.createRegistrationIntent({
        email: "fresh@example.com",
        password: "SecurePassword123!",
      });

      const taken = await registrationService.createRegistrationIntent({
        email: "taken@example.com",
        password: "SecurePassword123!",
      });

      expect(taken.intentId).toBeDefined();
      expect(taken.expectEmailVerification).toBe(fresh.expectEmailVerification);
      expect(taken.expectPhoneVerification).toBe(fresh.expectPhoneVerification);
      expect(taken.expectCaptcha).toBe(fresh.expectCaptcha);
    });

    it("sends the owner a warning instead of a usable code", async ({
      expect,
    }) => {
      const { registrationService, userService, emailProvider } =
        await setup(settings);

      await userService.users().create({
        username: "owner",
        email: "taken@example.com",
        roles: ["user"],
      });
      emailProvider.records = [];

      await registrationService.createRegistrationIntent({
        email: "taken@example.com",
        password: "SecurePassword123!",
      });

      // Sent inline: the mail is out when the call answers, as the
      // verification code of a fresh address is.
      expect(emailProvider.records).toHaveLength(1);
      const sent = emailProvider.records[0];
      // The owner is warned...
      expect(sent.to).toBe("taken@example.com");
      expect(sent.subject).toBe(
        "Someone tried to sign up with your email address",
      );
      // ...and no six-digit verification code was minted for the stranger.
      expect(sent.body).not.toMatch(/\d{6}/);
    });

    it("sends a fresh address its code, which is what the warning must not be", async ({
      expect,
    }) => {
      const { registrationService, emailProvider } = await setup(settings);

      await registrationService.createRegistrationIntent({
        email: "fresh@example.com",
        password: "SecurePassword123!",
      });

      expect(emailProvider.records).toHaveLength(1);
      expect(emailProvider.records[0].to).toBe("fresh@example.com");
      expect(emailProvider.records[0].body).toMatch(/\d{6}/);
    });

    it("refuses to complete the decoy intent", async ({ expect }) => {
      const { registrationService, userService } = await setup(settings);

      await userService.users().create({
        username: "owner",
        email: "taken@example.com",
        roles: ["user"],
      });

      const intent = await registrationService.createRegistrationIntent({
        email: "taken@example.com",
        password: "SecurePassword123!",
      });

      await expect(
        registrationService.completeRegistration({
          intentId: intent.intentId,
          emailCode: "000000",
        }),
      ).rejects.toThrow("Invalid or expired email verification code");
    });

    it("does not send a verification code to an address on file", async ({
      expect,
    }) => {
      const { registrationService, userService, emailProvider } =
        await setup(settings);
      await userService.users().create({
        username: "owner",
        email: "taken@example.com",
        roles: ["user"],
      });
      emailProvider.records = [];

      await registrationService.createRegistrationIntent({
        email: "taken@example.com",
        password: "SecurePassword123!",
      });

      expect(
        emailProvider.records.filter(
          (mail) =>
            mail.subject !== "Someone tried to sign up with your email address",
        ),
      ).toEqual([]);
    });
  });

  describe("without email verification", () => {
    it("reports a taken email without naming the field", async ({ expect }) => {
      const { registrationService, userService } = await setup();

      await userService.users().create({
        username: "owner",
        email: "taken@example.com",
        roles: ["user"],
      });

      await expect(
        registrationService.createRegistrationIntent({
          username: "brandnew",
          email: "taken@example.com",
          password: "SecurePassword123!",
        }),
      ).rejects.not.toThrow(/email/i);
    });

    it("reports a taken username and a taken email identically", async ({
      expect,
    }) => {
      const { registrationService, userService } = await setup();

      await userService.users().create({
        username: "owner",
        email: "taken@example.com",
        roles: ["user"],
      });

      const messageOf = async (body: {
        username: string;
        email: string;
      }): Promise<string> => {
        try {
          await registrationService.createRegistrationIntent({
            ...body,
            password: "SecurePassword123!",
          });
        } catch (error) {
          return (error as Error).message;
        }
        throw new AlephaError("expected a conflict");
      };

      const byUsername = await messageOf({
        username: "owner",
        email: "brandnew@example.com",
      });
      const byEmail = await messageOf({
        username: "brandnew",
        email: "taken@example.com",
      });

      expect(byUsername).toBe(byEmail);
    });
  });
});
