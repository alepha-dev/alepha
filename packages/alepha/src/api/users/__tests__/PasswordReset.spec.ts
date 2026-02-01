import { Alepha } from "alepha";
import { AlephaApiVerification } from "alepha/api/verifications";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { AlephaSecurity, CryptoProvider } from "alepha/security";
import { BadRequestError } from "alepha/server";
import { describe, it } from "vitest";
import {
  AlephaApiUsers,
  CredentialService,
  RealmProvider,
  SessionService,
  UserController,
  UserNotifications,
} from "../index.ts";

const setup = async () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error" },
  });

  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiVerification);
  alepha.with(AlephaApiUsers);
  alepha.with(UserNotifications);

  await alepha.start();

  // Enable notifications for the default realm
  const realmProvider = alepha.inject(RealmProvider);
  realmProvider.register("default", {
    features: {
      notifications: true,
    },
  });

  const emailProvider = alepha.inject(MemoryEmailProvider);
  emailProvider.records = [];

  return {
    alepha,
    credentialService: alepha.inject(CredentialService),
    sessionService: alepha.inject(SessionService),
    cryptoProvider: alepha.inject(CryptoProvider),
    dateTimeProvider: alepha.inject(DateTimeProvider),
    emailProvider,
    actions: alepha.inject(UserController),
  };
};

// Helper to extract code from email
const extractCode = (emailBody: string): string => {
  // Code is displayed in the email body as a 6-digit number
  const match = emailBody.match(/(\d{6})/);
  if (!match) throw new Error("Code not found in email");
  return match[1];
};

describe("alepha/api/users - Password Reset", () => {
  it("should successfully request password reset and send email", async ({
    expect,
  }) => {
    const { credentialService, cryptoProvider, emailProvider, actions } =
      await setup();

    // Create a test user with credentials
    const hashedPassword = await cryptoProvider.hashPassword("OldPassword123");
    const user = await credentialService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
    });

    await credentialService.identities().create({
      userId: user.id,
      provider: "credentials",
      providerUserId: "test@example.com",
      providerData: { password: hashedPassword },
    });

    // Request password reset
    const result = await actions.requestPasswordReset({
      body: {
        email: "test@example.com",
      },
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("password reset code has been sent");

    // Verify email was sent via password reset notification
    await expect.poll(() => emailProvider.records.length).toBe(1);
    const email = emailProvider.records[0];
    expect(email.to).toBe("test@example.com");
    expect(email.subject).toBe("Reset your password");
    // Check for 6-digit code in email
    expect(email.body).toMatch(/\d{6}/);
    expect(email.body).toContain("5 minutes"); // Default code verification expiration
  });

  it("should not reveal if email does not exist", async ({ expect }) => {
    const { emailProvider, actions } = await setup();

    // Request password reset for non-existent email
    const result = await actions.requestPasswordReset({
      body: {
        email: "nonexistent@example.com",
      },
    });

    // Should return success to prevent email enumeration
    expect(result.success).toBe(true);
    expect(result.message).toContain("password reset code has been sent");

    // But no email should be sent
    expect(emailProvider.records).toHaveLength(0);
  });

  it("should not send email for OAuth-only users", async ({ expect }) => {
    const { credentialService, emailProvider, actions } = await setup();

    // Create a user with only OAuth identity (no credentials)
    const user = await credentialService.users().create({
      username: "oauthuser",
      email: "oauth@example.com",
      roles: ["user"],
    });

    await credentialService.identities().create({
      userId: user.id,
      provider: "google",
      providerUserId: "google-123",
    });

    // Request password reset
    const result = await actions.requestPasswordReset({
      body: {
        email: "oauth@example.com",
      },
    });

    // Should return success but not send email
    expect(result.success).toBe(true);
    expect(emailProvider.records).toHaveLength(0);
  });

  it("should validate a valid reset token", async ({ expect }) => {
    const { credentialService, cryptoProvider, emailProvider, actions } =
      await setup();

    // Create a test user with credentials
    const hashedPassword = await cryptoProvider.hashPassword("OldPassword123");
    const user = await credentialService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
    });

    await credentialService.identities().create({
      userId: user.id,
      provider: "credentials",
      providerUserId: "test@example.com",
      providerData: { password: hashedPassword },
    });

    // Request password reset
    await credentialService.requestPasswordReset("test@example.com");

    // Extract code from email
    await expect.poll(() => emailProvider.records.length).toBe(1);
    const token = extractCode(emailProvider.records[0].body);

    // Validate token
    const result = await actions.validateResetToken({
      query: { email: "test@example.com", token },
    });

    expect(result.valid).toBe(true);
    expect(result.email).toBe("test@example.com");
  });

  it("should reject invalid reset token", async ({ expect }) => {
    const { actions } = await setup();

    // Validate invalid token
    const result = await actions.validateResetToken({
      query: {
        email: "test@example.com",
        token: "550e8400-e29b-41d4-a716-446655440000",
      },
    });

    expect(result.valid).toBe(false);
    expect(result.email).toBeUndefined();
  });

  it("should reject expired reset token", async ({ expect }) => {
    const {
      credentialService,
      cryptoProvider,
      dateTimeProvider,
      emailProvider,
      actions,
    } = await setup();

    // Create a test user with credentials
    const hashedPassword = await cryptoProvider.hashPassword("OldPassword123");
    const user = await credentialService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
    });

    await credentialService.identities().create({
      userId: user.id,
      provider: "credentials",
      providerUserId: "test@example.com",
      providerData: { password: hashedPassword },
    });

    // Request password reset
    await credentialService.requestPasswordReset("test@example.com");

    // Extract code
    await expect.poll(() => emailProvider.records.length).toBe(1);
    const token = extractCode(emailProvider.records[0].body);

    // Travel forward in time to expire the token (default expiration is 5 minutes for code verification)
    dateTimeProvider.travel(6, "minutes");

    // Validate expired token
    const result = await actions.validateResetToken({
      query: { email: "test@example.com", token },
    });

    expect(result.valid).toBe(false);
    expect(result.email).toBeUndefined();
  });

  it("should successfully reset password with valid token", async ({
    expect,
  }) => {
    const {
      credentialService,
      sessionService,
      cryptoProvider,
      emailProvider,
      actions,
    } = await setup();

    // Create a test user with credentials
    const hashedPassword = await cryptoProvider.hashPassword("OldPassword123");
    const user = await credentialService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
    });

    await credentialService.identities().create({
      userId: user.id,
      provider: "credentials",
      providerUserId: "test@example.com",
      providerData: { password: hashedPassword },
    });

    // Request password reset
    await credentialService.requestPasswordReset("test@example.com");

    // Extract code
    await expect.poll(() => emailProvider.records.length).toBe(1);
    const token = extractCode(emailProvider.records[0].body);

    // Reset password
    const result = await actions.resetPassword({
      body: {
        email: "test@example.com",
        token,
        newPassword: "NewPassword456",
      },
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("Password has been reset successfully");

    // Verify old password no longer works
    await expect(
      sessionService.login("credentials", "test@example.com", "OldPassword123"),
    ).rejects.toThrow();

    // Verify new password works
    const loggedInUser = await sessionService.login(
      "credentials",
      "test@example.com",
      "NewPassword456",
    );
    expect(loggedInUser?.email).toBe("test@example.com");
  });

  it("should reject password reset with invalid token", async ({ expect }) => {
    const { actions } = await setup();

    // Attempt to reset password with invalid token
    await expect(
      actions.resetPassword({
        body: {
          email: "test@example.com",
          token: "550e8400-e29b-41d4-a716-446655440000",
          newPassword: "NewPassword456",
        },
      }),
    ).rejects.toThrowError(BadRequestError);
  });

  it("should reject password reset with expired token", async ({ expect }) => {
    const {
      credentialService,
      cryptoProvider,
      dateTimeProvider,
      emailProvider,
      actions,
    } = await setup();

    // Create a test user with credentials
    const hashedPassword = await cryptoProvider.hashPassword("OldPassword123");
    const user = await credentialService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
    });

    await credentialService.identities().create({
      userId: user.id,
      provider: "credentials",
      providerUserId: "test@example.com",
      providerData: { password: hashedPassword },
    });

    // Request password reset
    await credentialService.requestPasswordReset("test@example.com");

    // Extract code
    await expect.poll(() => emailProvider.records.length).toBe(1);
    const token = extractCode(emailProvider.records[0].body);

    // Travel forward in time to expire the token (5 minutes for code)
    dateTimeProvider.travel(6, "minutes");

    // Attempt to reset password with expired token
    await expect(
      actions.resetPassword({
        body: {
          email: "test@example.com",
          token,
          newPassword: "NewPassword456",
        },
      }),
    ).rejects.toThrowError(BadRequestError);
  });

  it("should not allow token reuse after successful password reset", async ({
    expect,
  }) => {
    const { credentialService, cryptoProvider, emailProvider, actions } =
      await setup();

    // Create a test user with credentials
    const hashedPassword = await cryptoProvider.hashPassword("OldPassword123");
    const user = await credentialService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
    });

    await credentialService.identities().create({
      userId: user.id,
      provider: "credentials",
      providerUserId: "test@example.com",
      providerData: { password: hashedPassword },
    });

    // Request password reset
    await credentialService.requestPasswordReset("test@example.com");

    // Extract code
    await expect.poll(() => emailProvider.records.length).toBe(1);
    const token = extractCode(emailProvider.records[0].body);

    // Reset password
    await actions.resetPassword({
      body: {
        email: "test@example.com",
        token,
        newPassword: "NewPassword456",
      },
    });

    // Attempt to use the same token again should fail
    await expect(
      actions.resetPassword({
        body: {
          email: "test@example.com",
          token,
          newPassword: "AnotherPassword789",
        },
      }),
    ).rejects.toThrowError(BadRequestError);
  });

  it("should invalidate all sessions after password reset", async ({
    expect,
  }) => {
    const {
      credentialService,
      sessionService,
      cryptoProvider,
      emailProvider,
      actions,
    } = await setup();

    // Create a test user with credentials
    const hashedPassword = await cryptoProvider.hashPassword("OldPassword123");
    const user = await credentialService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
    });

    await credentialService.identities().create({
      userId: user.id,
      provider: "credentials",
      providerUserId: "test@example.com",
      providerData: { password: hashedPassword },
    });

    // Create some sessions
    await sessionService.createSession(user, 3600);
    await sessionService.createSession(user, 3600);

    // Verify sessions exist
    const existingSessions = await sessionService.sessions().findMany({
      where: { userId: { eq: user.id } },
    });
    expect(existingSessions).toHaveLength(2);

    // Request password reset and reset password
    await credentialService.requestPasswordReset("test@example.com");

    await expect.poll(() => emailProvider.records.length).toBe(1);
    const token = extractCode(emailProvider.records[0].body);

    await actions.resetPassword({
      body: {
        email: "test@example.com",
        token,
        newPassword: "NewPassword456",
      },
    });

    // Verify all sessions are deleted
    const remainingSessions = await sessionService.sessions().findMany({
      where: { userId: { eq: user.id } },
    });
    expect(remainingSessions).toHaveLength(0);
  });

  it("should enforce minimum password length", async ({ expect }) => {
    const { credentialService, cryptoProvider, emailProvider, actions } =
      await setup();

    // Create a test user with credentials
    const hashedPassword = await cryptoProvider.hashPassword("OldPassword123");
    const user = await credentialService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
    });

    await credentialService.identities().create({
      userId: user.id,
      provider: "credentials",
      providerUserId: "test@example.com",
      providerData: { password: hashedPassword },
    });

    // Request password reset
    await credentialService.requestPasswordReset("test@example.com");

    await expect.poll(() => emailProvider.records.length).toBe(1);
    const token = extractCode(emailProvider.records[0].body);

    // Attempt to reset with short password (less than 8 characters)
    await expect(
      actions.resetPassword({
        body: {
          email: "test@example.com",
          token,
          newPassword: "Short1", // Only 6 characters
        },
      }),
    ).rejects.toThrow();
  });

  it("should respect rate limiting on password reset requests", async ({
    expect,
  }) => {
    const {
      credentialService,
      cryptoProvider,
      dateTimeProvider,
      emailProvider,
      actions,
    } = await setup();

    // Create a test user with credentials
    const hashedPassword = await cryptoProvider.hashPassword("OldPassword123");
    const user = await credentialService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
    });

    await credentialService.identities().create({
      userId: user.id,
      provider: "credentials",
      providerUserId: "test@example.com",
      providerData: { password: hashedPassword },
    });

    // Request password reset multiple times within cooldown period
    await actions.requestPasswordReset({
      body: {
        email: "test@example.com",
      },
    });

    await expect.poll(() => emailProvider.records.length).toBe(1);

    // Second request should be silently ignored (cooldown)
    await actions.requestPasswordReset({
      body: {
        email: "test@example.com",
      },
    });

    // Still only 1 email
    expect(emailProvider.records.length).toBe(1);

    // Wait for cooldown to pass (90 seconds default)
    dateTimeProvider.travel(91, "seconds");

    // Now should work
    await actions.requestPasswordReset({
      body: {
        email: "test@example.com",
      },
    });

    await expect.poll(() => emailProvider.records.length).toBe(2);
  });
});
