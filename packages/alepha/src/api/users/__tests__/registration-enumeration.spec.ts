import { Alepha } from "alepha";
import { AlephaApiVerification } from "alepha/api/verifications";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
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

  alepha.with(AlephaOrmPostgres);
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
    realmProvider.register("default", {
      // Verification and the owner-warning both go out as notifications.
      features: { notifications: true },
      settings: realmSettings as never,
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

      await expect.poll(() => emailProvider.records.length).toBe(1);
      const sent = emailProvider.records[0];
      // The owner is warned...
      expect(JSON.stringify(sent)).toMatch(/taken@example\.com/);
      // ...but no six-digit verification code was minted for the attacker.
      expect(JSON.stringify(sent)).not.toMatch(/\b\d{6}\b/);
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
      ).rejects.toThrow();
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
        throw new Error("expected a conflict");
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
