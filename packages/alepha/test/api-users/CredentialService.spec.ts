import { Alepha } from "alepha";
import {
  AlephaApiUsers,
  CredentialService,
  SessionService,
  UserService,
} from "alepha/api/users";
import { AlephaApiVerification } from "alepha/api/verifications";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { AlephaSecurity, CryptoProvider } from "alepha/security";
import { BadRequestError, HttpError } from "alepha/server";
import { describe, it } from "vitest";

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error" },
  });

  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiVerification);
  alepha.with(AlephaApiUsers);

  await alepha.start();

  const emailProvider = alepha.inject(MemoryEmailProvider);
  emailProvider.records = [];

  return {
    alepha,
    credentialService: alepha.inject(CredentialService),
    userService: alepha.inject(UserService),
    sessionService: alepha.inject(SessionService),
    cryptoProvider: alepha.inject(CryptoProvider),
    dateTimeProvider: alepha.inject(DateTimeProvider),
    emailProvider,
  };
};

// Helper to extract code from email
const extractCode = (emailBody: string): string => {
  const match = emailBody.match(/(\d{6})/);
  if (!match) throw new Error("Code not found in email");
  return match[1];
};

// Helper to create a user with credentials
const createUserWithCredentials = async (
  userService: UserService,
  credentialService: CredentialService,
  cryptoProvider: CryptoProvider,
  email: string,
  password: string,
) => {
  const user = await userService.users().create({
    email,
    username: email.split("@")[0],
    roles: ["user"],
  });

  const hashedPassword = await cryptoProvider.hashPassword(password);

  await credentialService.identities().create({
    userId: user.id,
    provider: "credentials",
    password: hashedPassword,
  });

  return user;
};

describe("alepha/api/users - CredentialService", () => {
  describe("Phase 1: createPasswordResetIntent", () => {
    it("should create a password reset intent for existing user", async ({
      expect,
    }) => {
      const { credentialService, userService, cryptoProvider, emailProvider } =
        await setup();

      await createUserWithCredentials(
        userService,
        credentialService,
        cryptoProvider,
        "reset@example.com",
        "OldPassword123!",
      );

      const result =
        await credentialService.createPasswordResetIntent("reset@example.com");

      expect(result.intentId).toBeDefined();
      expect(result.expiresAt).toBeDefined();

      // Verify email was sent
      await expect.poll(() => emailProvider.records.length).toBe(1);
      expect(emailProvider.records[0].to).toBe("reset@example.com");
      expect(emailProvider.records[0].subject).toBe("Reset your password");
    });

    it("should return fake intent for non-existent email (security)", async ({
      expect,
    }) => {
      const { credentialService, emailProvider } = await setup();

      // Should still return a response (security - don't reveal if email exists)
      const result = await credentialService.createPasswordResetIntent(
        "nonexistent@example.com",
      );

      expect(result.intentId).toBeDefined();
      expect(result.expiresAt).toBeDefined();

      // No email should be sent
      expect(emailProvider.records.length).toBe(0);
    });

    it("should return fake intent for user without credentials identity", async ({
      expect,
    }) => {
      const { credentialService, userService, emailProvider } = await setup();

      // Create user without credentials (OAuth-only user)
      await userService.users().create({
        email: "oauth@example.com",
        username: "oauthuser",
        roles: ["user"],
      });

      // Should still return a response
      const result =
        await credentialService.createPasswordResetIntent("oauth@example.com");

      expect(result.intentId).toBeDefined();
      expect(result.expiresAt).toBeDefined();

      // No email should be sent
      expect(emailProvider.records.length).toBe(0);
    });

    it("should set correct expiration time (10 minutes)", async ({
      expect,
    }) => {
      const {
        credentialService,
        userService,
        cryptoProvider,
        dateTimeProvider,
      } = await setup();

      await createUserWithCredentials(
        userService,
        credentialService,
        cryptoProvider,
        "expiry@example.com",
        "Password123!",
      );

      const before = dateTimeProvider.now();

      const result =
        await credentialService.createPasswordResetIntent("expiry@example.com");

      const expiresAt = dateTimeProvider.of(result.expiresAt);
      const expectedExpiry = before.add(10, "minutes");

      // Should expire approximately 10 minutes from now
      expect(expiresAt.diff(expectedExpiry, "seconds")).toBeLessThan(5);
    });
  });

  describe("Phase 2: completePasswordReset", () => {
    it("should complete password reset with valid code", async ({ expect }) => {
      const {
        credentialService,
        userService,
        sessionService,
        cryptoProvider,
        emailProvider,
      } = await setup();

      await createUserWithCredentials(
        userService,
        credentialService,
        cryptoProvider,
        "complete@example.com",
        "OldPassword123!",
      );

      // Phase 1: Create intent
      const intent = await credentialService.createPasswordResetIntent(
        "complete@example.com",
      );

      // Extract code from email
      await expect.poll(() => emailProvider.records.length).toBe(1);
      const code = extractCode(emailProvider.records[0].body);

      // Phase 2: Complete password reset
      await credentialService.completePasswordReset({
        intentId: intent.intentId,
        code,
        newPassword: "NewPassword456!",
      });

      // Verify new password works
      const loggedInUser = await sessionService.login(
        "credentials",
        "complete@example.com",
        "NewPassword456!",
      );

      expect(loggedInUser?.email).toBe("complete@example.com");
    });

    it("should reject expired intent (410 Gone)", async ({ expect }) => {
      const {
        credentialService,
        userService,
        cryptoProvider,
        dateTimeProvider,
        emailProvider,
      } = await setup();

      await createUserWithCredentials(
        userService,
        credentialService,
        cryptoProvider,
        "expired@example.com",
        "OldPassword123!",
      );

      // Create intent
      const intent = await credentialService.createPasswordResetIntent(
        "expired@example.com",
      );

      // Extract code
      await expect.poll(() => emailProvider.records.length).toBe(1);
      const code = extractCode(emailProvider.records[0].body);

      // Travel forward 11 minutes (intent expires at 10)
      dateTimeProvider.travel(11, "minutes");

      // Attempt to complete
      await expect(
        credentialService.completePasswordReset({
          intentId: intent.intentId,
          code,
          newPassword: "NewPassword456!",
        }),
      ).rejects.toThrow(HttpError);
    });

    it("should reject invalid intent ID", async ({ expect }) => {
      const { credentialService } = await setup();

      await expect(
        credentialService.completePasswordReset({
          intentId: "550e8400-e29b-41d4-a716-446655440000",
          code: "123456",
          newPassword: "NewPassword456!",
        }),
      ).rejects.toThrow(HttpError);
    });

    it("should reject invalid verification code", async ({ expect }) => {
      const { credentialService, userService, cryptoProvider, emailProvider } =
        await setup();

      await createUserWithCredentials(
        userService,
        credentialService,
        cryptoProvider,
        "wrongcode@example.com",
        "OldPassword123!",
      );

      const intent = await credentialService.createPasswordResetIntent(
        "wrongcode@example.com",
      );

      // Wait for email
      await expect.poll(() => emailProvider.records.length).toBe(1);

      await expect(
        credentialService.completePasswordReset({
          intentId: intent.intentId,
          code: "000000", // Wrong code
          newPassword: "NewPassword456!",
        }),
      ).rejects.toThrowError(BadRequestError);
    });

    it("should not allow intent reuse after successful reset", async ({
      expect,
    }) => {
      const { credentialService, userService, cryptoProvider, emailProvider } =
        await setup();

      await createUserWithCredentials(
        userService,
        credentialService,
        cryptoProvider,
        "onetime@example.com",
        "OldPassword123!",
      );

      const intent = await credentialService.createPasswordResetIntent(
        "onetime@example.com",
      );

      // Extract code
      await expect.poll(() => emailProvider.records.length).toBe(1);
      const code = extractCode(emailProvider.records[0].body);

      // First completion should succeed
      await credentialService.completePasswordReset({
        intentId: intent.intentId,
        code,
        newPassword: "NewPassword456!",
      });

      // Second attempt should fail (intent deleted)
      await expect(
        credentialService.completePasswordReset({
          intentId: intent.intentId,
          code,
          newPassword: "AnotherPassword789!",
        }),
      ).rejects.toThrow(HttpError);
    });

    it("should invalidate all existing sessions after password reset", async ({
      expect,
    }) => {
      const {
        credentialService,
        userService,
        sessionService,
        cryptoProvider,
        emailProvider,
      } = await setup();

      const user = await createUserWithCredentials(
        userService,
        credentialService,
        cryptoProvider,
        "sessions@example.com",
        "OldPassword123!",
      );

      // Create a session
      await sessionService.sessions().create({
        userId: user.id,
        refreshToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      // Verify session exists
      const sessionsBefore = await sessionService.sessions().findMany({
        where: { userId: { eq: user.id } },
      });
      expect(sessionsBefore).toHaveLength(1);

      // Create password reset intent
      const intent = await credentialService.createPasswordResetIntent(
        "sessions@example.com",
      );

      // Extract code
      await expect.poll(() => emailProvider.records.length).toBe(1);
      const code = extractCode(emailProvider.records[0].body);

      // Complete password reset
      await credentialService.completePasswordReset({
        intentId: intent.intentId,
        code,
        newPassword: "NewPassword456!",
      });

      // Verify all sessions are invalidated
      const sessionsAfter = await sessionService.sessions().findMany({
        where: { userId: { eq: user.id } },
      });
      expect(sessionsAfter).toHaveLength(0);
    });

    it("should not allow old password after reset", async ({ expect }) => {
      const {
        credentialService,
        userService,
        sessionService,
        cryptoProvider,
        emailProvider,
      } = await setup();

      await createUserWithCredentials(
        userService,
        credentialService,
        cryptoProvider,
        "oldpass@example.com",
        "OldPassword123!",
      );

      // Verify old password works before reset
      const beforeReset = await sessionService.login(
        "credentials",
        "oldpass@example.com",
        "OldPassword123!",
      );
      expect(beforeReset?.email).toBe("oldpass@example.com");

      // Create intent and reset password
      const intent = await credentialService.createPasswordResetIntent(
        "oldpass@example.com",
      );

      await expect.poll(() => emailProvider.records.length).toBe(1);
      const code = extractCode(emailProvider.records[0].body);

      await credentialService.completePasswordReset({
        intentId: intent.intentId,
        code,
        newPassword: "NewPassword456!",
      });

      // Old password should no longer work (login throws error for invalid credentials)
      await expect(
        sessionService.login(
          "credentials",
          "oldpass@example.com",
          "OldPassword123!",
        ),
      ).rejects.toThrow();
    });
  });

  describe("Full password reset flow integration", () => {
    it("should complete full password reset flow", async ({ expect }) => {
      const {
        credentialService,
        userService,
        sessionService,
        cryptoProvider,
        emailProvider,
      } = await setup();

      // Create user
      await createUserWithCredentials(
        userService,
        credentialService,
        cryptoProvider,
        "fullflow@example.com",
        "OldPassword123!",
      );

      // Phase 1: Request password reset
      const intent = await credentialService.createPasswordResetIntent(
        "fullflow@example.com",
      );

      expect(intent.intentId).toBeDefined();
      expect(intent.expiresAt).toBeDefined();

      // Verify email was sent
      await expect.poll(() => emailProvider.records.length).toBe(1);
      expect(emailProvider.records[0].to).toBe("fullflow@example.com");
      const code = extractCode(emailProvider.records[0].body);

      // Phase 2: Complete password reset
      await credentialService.completePasswordReset({
        intentId: intent.intentId,
        code,
        newPassword: "NewSecurePassword789!",
      });

      // Verify new password works
      const user = await sessionService.login(
        "credentials",
        "fullflow@example.com",
        "NewSecurePassword789!",
      );

      expect(user?.email).toBe("fullflow@example.com");
    });
  });

  describe("Legacy methods (backward compatibility)", () => {
    it("requestPasswordReset should work as before", async ({ expect }) => {
      const { credentialService, userService, cryptoProvider, emailProvider } =
        await setup();

      await createUserWithCredentials(
        userService,
        credentialService,
        cryptoProvider,
        "legacy@example.com",
        "OldPassword123!",
      );

      const result =
        await credentialService.requestPasswordReset("legacy@example.com");

      expect(result).toBe(true);
      await expect.poll(() => emailProvider.records.length).toBe(1);
    });
  });
});
