import { Alepha } from "alepha";
import { AlephaApiVerification } from "alepha/api/verifications";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { AlephaSecurity } from "alepha/security";
import { BadRequestError } from "alepha/server";
import { describe, it } from "vitest";
import {
  AlephaApiUsers,
  RealmProvider,
  UserController,
  UserNotifications,
  UserService,
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
    userService: alepha.inject(UserService),
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

describe("alepha/api/users - Email Verification", () => {
  it("should successfully request email verification and send email", async ({
    expect,
  }) => {
    const { userService, emailProvider, actions } = await setup();

    // Create a test user
    const user = await userService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
      emailVerified: false,
    });

    // Request email verification
    const result = await actions.requestEmailVerification({
      body: {
        email: "test@example.com",
      },
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("verification code has been sent");

    // Verify email was sent via verification service
    await expect.poll(() => emailProvider.records.length).toBe(1);
    const email = emailProvider.records[0];
    expect(email.to).toBe("test@example.com");
    expect(email.subject).toBe("Verify your email address");
    // Check for 6-digit code in email
    expect(email.body).toMatch(/\d{6}/);
    expect(email.body).toContain("5 minutes"); // Default code verification expiration
  });

  it("should not reveal if email does not exist", async ({ expect }) => {
    const { emailProvider, actions } = await setup();

    // Request email verification for non-existent email
    const result = await actions.requestEmailVerification({
      body: {
        email: "nonexistent@example.com",
      },
    });

    // Should return success to prevent email enumeration
    expect(result.success).toBe(true);
    expect(result.message).toContain("verification code has been sent");

    // But no email should be sent
    expect(emailProvider.records).toHaveLength(0);
  });

  it("should not send email if already verified", async ({ expect }) => {
    const { userService, emailProvider, actions } = await setup();

    // Create a user with already verified email
    await userService.users().create({
      username: "verifieduser",
      email: "verified@example.com",
      roles: ["user"],
      emailVerified: true,
    });

    // Request email verification
    const result = await actions.requestEmailVerification({
      body: {
        email: "verified@example.com",
      },
    });

    // Should return success but not send email
    expect(result.success).toBe(true);
    expect(emailProvider.records).toHaveLength(0);
  });

  it("should successfully verify email with valid token", async ({
    expect,
  }) => {
    const { userService, emailProvider, actions } = await setup();

    // Create a test user
    const user = await userService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
      emailVerified: false,
    });

    // Request email verification
    await userService.requestEmailVerification("test@example.com");

    // Extract code from email
    await expect.poll(() => emailProvider.records.length).toBe(1);
    const token = extractCode(emailProvider.records[0].body);

    // Verify email
    const result = await actions.verifyEmail({
      body: {
        email: "test@example.com",
        token,
      },
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("Email has been verified successfully");

    // Check that emailVerified is now true
    const updatedUser = await userService.users().findOne({
      where: { id: { eq: user.id } },
    });
    expect(updatedUser.emailVerified).toBe(true);
  });

  it("should reject invalid verification token", async ({ expect }) => {
    const { userService, actions } = await setup();

    // Create a test user
    await userService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
      emailVerified: false,
    });

    // Attempt to verify with invalid token
    await expect(
      actions.verifyEmail({
        body: {
          email: "test@example.com",
          token: "550e8400-e29b-41d4-a716-446655440000",
        },
      }),
    ).rejects.toThrowError(BadRequestError);
  });

  it("should reject expired verification token", async ({ expect }) => {
    const { userService, dateTimeProvider, emailProvider, actions } =
      await setup();

    // Create a test user
    await userService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
      emailVerified: false,
    });

    // Request email verification
    await userService.requestEmailVerification("test@example.com");

    // Extract code
    await expect.poll(() => emailProvider.records.length).toBe(1);
    const token = extractCode(emailProvider.records[0].body);

    // Travel forward in time to expire the token (default expiration is 5 minutes for code verification)
    dateTimeProvider.travel(6, "minutes");

    // Attempt to verify with expired token
    await expect(
      actions.verifyEmail({
        body: {
          email: "test@example.com",
          token,
        },
      }),
    ).rejects.toThrowError(BadRequestError);
  });

  it("should not allow token reuse after successful verification", async ({
    expect,
  }) => {
    const { userService, emailProvider, actions } = await setup();

    // Create a test user
    await userService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
      emailVerified: false,
    });

    // Request email verification
    await userService.requestEmailVerification("test@example.com");

    // Extract code
    await expect.poll(() => emailProvider.records.length).toBe(1);
    const token = extractCode(emailProvider.records[0].body);

    // Verify email
    await actions.verifyEmail({
      body: {
        email: "test@example.com",
        token,
      },
    });

    // Attempt to use the same token again should fail
    await expect(
      actions.verifyEmail({
        body: {
          email: "test@example.com",
          token,
        },
      }),
    ).rejects.toThrowError(BadRequestError);
  });

  it("should check email verification status", async ({ expect }) => {
    const { userService, actions } = await setup();

    // Create a test user with unverified email
    await userService.users().create({
      username: "unverifieduser",
      email: "unverified@example.com",
      roles: ["user"],
      emailVerified: false,
    });

    // Create a test user with verified email
    await userService.users().create({
      username: "verifieduser",
      email: "verified@example.com",
      roles: ["user"],
      emailVerified: true,
    });

    // Check unverified email
    const unverifiedResult = await actions.checkEmailVerification({
      query: { email: "unverified@example.com" },
    });
    expect(unverifiedResult.verified).toBe(false);

    // Check verified email
    const verifiedResult = await actions.checkEmailVerification({
      query: { email: "verified@example.com" },
    });
    expect(verifiedResult.verified).toBe(true);

    // Check non-existent email
    const nonExistentResult = await actions.checkEmailVerification({
      query: { email: "nonexistent@example.com" },
    });
    expect(nonExistentResult.verified).toBe(false);
  });

  it("should respect rate limiting on verification requests", async ({
    expect,
  }) => {
    const { userService, dateTimeProvider, emailProvider, actions } =
      await setup();

    // Create a test user
    await userService.users().create({
      username: "testuser",
      email: "test@example.com",
      roles: ["user"],
      emailVerified: false,
    });

    // Request email verification multiple times within cooldown period
    await actions.requestEmailVerification({
      body: {
        email: "test@example.com",
      },
    });

    await expect.poll(() => emailProvider.records.length).toBe(1);

    // Second request should be silently ignored (cooldown)
    await actions.requestEmailVerification({
      body: {
        email: "test@example.com",
      },
    });

    // Still only 1 email
    expect(emailProvider.records.length).toBe(1);

    // Wait for cooldown to pass (90 seconds default)
    dateTimeProvider.travel(91, "seconds");

    // Now should work
    await actions.requestEmailVerification({
      body: {
        email: "test@example.com",
      },
    });

    await expect.poll(() => emailProvider.records.length).toBe(2);
  });

  it("should correctly identify verified vs unverified users using isEmailVerified", async ({
    expect,
  }) => {
    const { userService } = await setup();

    // Create users with different verification statuses
    await userService.users().create({
      username: "unverifieduser",
      email: "unverified@example.com",
      roles: ["user"],
      emailVerified: false,
    });

    await userService.users().create({
      username: "verifieduser",
      email: "verified@example.com",
      roles: ["user"],
      emailVerified: true,
    });

    // Check verification status
    const unverifiedStatus = await userService.isEmailVerified(
      "unverified@example.com",
    );
    expect(unverifiedStatus).toBe(false);

    const verifiedStatus = await userService.isEmailVerified(
      "verified@example.com",
    );
    expect(verifiedStatus).toBe(true);

    const nonExistentStatus = await userService.isEmailVerified(
      "nonexistent@example.com",
    );
    expect(nonExistentStatus).toBe(false);
  });
});
