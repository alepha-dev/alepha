import { Alepha } from "alepha";
import { AlephaApiVerification } from "alepha/api/verifications";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { AlephaSecurity, CryptoProvider } from "alepha/security";
import { BadRequestError, ConflictError, HttpError } from "alepha/server";
import { describe, it } from "vitest";
import {
  AlephaApiUsers,
  RegistrationService,
  SessionService,
  UserRealmProvider,
  UserService,
} from "../index.ts";

const setup = async (realmSettings?: Record<string, unknown>) => {
  const alepha = Alepha.create();

  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiVerification);
  alepha.with(AlephaApiUsers);

  await alepha.start();

  const emailProvider = alepha.inject(MemoryEmailProvider);
  emailProvider.records = [];

  const userRealmProvider = alepha.inject(UserRealmProvider);

  // Configure realm settings if provided (applies to default realm)
  if (realmSettings) {
    userRealmProvider.register("default", {
      settings: realmSettings as never,
    });
  }

  return {
    alepha,
    registrationService: alepha.inject(RegistrationService),
    userService: alepha.inject(UserService),
    sessionService: alepha.inject(SessionService),
    cryptoProvider: alepha.inject(CryptoProvider),
    dateTimeProvider: alepha.inject(DateTimeProvider),
    emailProvider,
    userRealmProvider,
  };
};

// Helper to extract code from email
const extractCode = (emailBody: string): string => {
  const match = emailBody.match(/(\d{6})/);
  if (!match) throw new Error("Code not found in email");
  return match[1];
};

describe("alepha/api/users - RegistrationService", () => {
  describe("Phase 1: createRegistrationIntent", () => {
    it("should create a registration intent with valid data", async ({
      expect,
    }) => {
      const { registrationService } = await setup();

      const result = await registrationService.createRegistrationIntent({
        email: "newuser@example.com",
        password: "SecurePassword123!",
        username: "newuser",
        firstName: "New",
        lastName: "User",
      });

      expect(result.intentId).toBeDefined();
      expect(result.expiresAt).toBeDefined();
      expect(result.expectCaptcha).toBe(false);
      expect(result.expectEmailVerification).toBe(false);
      expect(result.expectPhoneVerification).toBe(false);
    });

    it("should create intent with email verification required when configured", async ({
      expect,
    }) => {
      const { registrationService, emailProvider, userRealmProvider } =
        await setup();

      // Register realm with email verification required
      userRealmProvider.register("verify-email-realm", {
        settings: {
          verifyEmailRequired: true,
        } as never,
      });

      const result = await registrationService.createRegistrationIntent(
        {
          email: "verify@example.com",
          password: "SecurePassword123!",
        },
        "verify-email-realm",
      );

      expect(result.intentId).toBeDefined();
      expect(result.expectEmailVerification).toBe(true);
      expect(result.expectPhoneVerification).toBe(false);
      expect(result.expectCaptcha).toBe(false);

      // Verify email was sent
      await expect.poll(() => emailProvider.records.length).toBe(1);
      expect(emailProvider.records[0].to).toBe("verify@example.com");
      expect(emailProvider.records[0].subject).toBe(
        "Verify your email address",
      );
    });

    it("should reject registration when disabled in realm settings", async ({
      expect,
    }) => {
      const { registrationService, userRealmProvider } = await setup();

      userRealmProvider.register("no-registration-realm", {
        settings: {
          registrationAllowed: false,
        } as never,
      });

      await expect(
        registrationService.createRegistrationIntent(
          {
            email: "test@example.com",
            password: "SecurePassword123!",
          },
          "no-registration-realm",
        ),
      ).rejects.toThrowError(BadRequestError);
    });

    it("should reject when required username is missing", async ({
      expect,
    }) => {
      const { registrationService, userRealmProvider } = await setup();

      userRealmProvider.register("username-required-realm", {
        settings: {
          usernameRequired: true,
        } as never,
      });

      await expect(
        registrationService.createRegistrationIntent(
          {
            email: "test@example.com",
            password: "SecurePassword123!",
            // username is missing
          },
          "username-required-realm",
        ),
      ).rejects.toThrowError(BadRequestError);
    });

    it("should reject when required email is missing", async ({ expect }) => {
      const { registrationService } = await setup();

      // Default realm requires email
      await expect(
        registrationService.createRegistrationIntent({
          username: "testuser",
          password: "SecurePassword123!",
          // email is missing
        }),
      ).rejects.toThrowError(BadRequestError);
    });

    it("should reject when required phone is missing", async ({ expect }) => {
      const { registrationService, userRealmProvider } = await setup();

      userRealmProvider.register("phone-required-realm", {
        settings: {
          phoneRequired: true,
          emailRequired: false,
        } as never,
      });

      await expect(
        registrationService.createRegistrationIntent(
          {
            email: "test@example.com",
            password: "SecurePassword123!",
            // phoneNumber is missing
          },
          "phone-required-realm",
        ),
      ).rejects.toThrowError(BadRequestError);
    });

    it("should reject duplicate username", async ({ expect }) => {
      const { registrationService, userService } = await setup();

      // Create existing user
      await userService.users().create({
        username: "existinguser",
        email: "existing@example.com",
        roles: ["user"],
      });

      await expect(
        registrationService.createRegistrationIntent({
          username: "existinguser",
          email: "new@example.com",
          password: "SecurePassword123!",
        }),
      ).rejects.toThrowError(ConflictError);
    });

    it("should reject duplicate email", async ({ expect }) => {
      const { registrationService, userService } = await setup();

      // Create existing user
      await userService.users().create({
        username: "existinguser",
        email: "existing@example.com",
        roles: ["user"],
      });

      await expect(
        registrationService.createRegistrationIntent({
          username: "newuser",
          email: "existing@example.com",
          password: "SecurePassword123!",
        }),
      ).rejects.toThrowError(ConflictError);
    });

    it("should reject duplicate phone number", async ({ expect }) => {
      const { registrationService, userService, userRealmProvider } =
        await setup();

      userRealmProvider.register("phone-realm", {
        settings: {
          phoneEnabled: true,
          emailRequired: false,
        } as never,
      });

      // Create existing user with phone
      await userService.users("phone-realm").create({
        username: "existinguser",
        email: "existing@example.com",
        phoneNumber: "+1234567890",
        roles: ["user"],
      });

      await expect(
        registrationService.createRegistrationIntent(
          {
            username: "newuser",
            email: "new@example.com",
            phoneNumber: "+1234567890",
            password: "SecurePassword123!",
          },
          "phone-realm",
        ),
      ).rejects.toThrowError(ConflictError);
    });

    it("should set correct expiration time (10 minutes)", async ({
      expect,
    }) => {
      const { registrationService, dateTimeProvider } = await setup();

      const before = dateTimeProvider.now();

      const result = await registrationService.createRegistrationIntent({
        email: "expiry@example.com",
        password: "SecurePassword123!",
      });

      const expiresAt = dateTimeProvider.of(result.expiresAt);
      const expectedExpiry = before.add(10, "minutes");

      // Should expire approximately 10 minutes from now
      expect(expiresAt.diff(expectedExpiry, "seconds")).toBeLessThan(5);
    });
  });

  describe("Phase 2: completeRegistration", () => {
    it("should complete registration without verification requirements", async ({
      expect,
    }) => {
      const { registrationService, userService } = await setup();

      // Create intent
      const intent = await registrationService.createRegistrationIntent({
        email: "complete@example.com",
        password: "SecurePassword123!",
        username: "completeuser",
        firstName: "Complete",
        lastName: "User",
      });

      // Complete registration
      const user = await registrationService.completeRegistration({
        intentId: intent.intentId,
      });

      expect(user.id).toBeDefined();
      expect(user.email).toBe("complete@example.com");
      expect(user.username).toBe("completeuser");
      expect(user.firstName).toBe("Complete");
      expect(user.lastName).toBe("User");
      expect(user.roles).toContain("user");
      expect(user.enabled).toBe(true);
    });

    it("should complete registration with valid email verification code", async ({
      expect,
    }) => {
      const { registrationService, emailProvider, userRealmProvider } =
        await setup();

      userRealmProvider.register("email-verify-realm", {
        settings: {
          verifyEmailRequired: true,
        } as never,
      });

      // Create intent (sends verification email)
      const intent = await registrationService.createRegistrationIntent(
        {
          email: "emailverify@example.com",
          password: "SecurePassword123!",
        },
        "email-verify-realm",
      );

      expect(intent.expectEmailVerification).toBe(true);

      // Extract code from email
      await expect.poll(() => emailProvider.records.length).toBe(1);
      const emailCode = extractCode(emailProvider.records[0].body);

      // Complete registration with code
      const user = await registrationService.completeRegistration({
        intentId: intent.intentId,
        emailCode,
      });

      expect(user.email).toBe("emailverify@example.com");
      expect(user.emailVerified).toBe(true);
    });

    it("should reject expired intent (410 Gone)", async ({ expect }) => {
      const { registrationService, dateTimeProvider } = await setup();

      // Create intent
      const intent = await registrationService.createRegistrationIntent({
        email: "expired@example.com",
        password: "SecurePassword123!",
      });

      // Travel forward 11 minutes (intent expires at 10)
      dateTimeProvider.travel(11, "minutes");

      // Attempt to complete
      await expect(
        registrationService.completeRegistration({
          intentId: intent.intentId,
        }),
      ).rejects.toThrow(HttpError);
    });

    it("should reject invalid intent ID", async ({ expect }) => {
      const { registrationService } = await setup();

      await expect(
        registrationService.completeRegistration({
          intentId: "550e8400-e29b-41d4-a716-446655440000",
        }),
      ).rejects.toThrow(HttpError);
    });

    it("should reject when email code is required but not provided", async ({
      expect,
    }) => {
      const { registrationService, userRealmProvider } = await setup();

      userRealmProvider.register("email-required-realm", {
        settings: {
          verifyEmailRequired: true,
        } as never,
      });

      const intent = await registrationService.createRegistrationIntent(
        {
          email: "needscode@example.com",
          password: "SecurePassword123!",
        },
        "email-required-realm",
      );

      await expect(
        registrationService.completeRegistration({
          intentId: intent.intentId,
          // emailCode not provided
        }),
      ).rejects.toThrowError(BadRequestError);
    });

    it("should reject invalid email verification code", async ({ expect }) => {
      const { registrationService, userRealmProvider } = await setup();

      userRealmProvider.register("email-verify-realm", {
        settings: {
          verifyEmailRequired: true,
        } as never,
      });

      const intent = await registrationService.createRegistrationIntent(
        {
          email: "wrongcode@example.com",
          password: "SecurePassword123!",
        },
        "email-verify-realm",
      );

      await expect(
        registrationService.completeRegistration({
          intentId: intent.intentId,
          emailCode: "000000", // Wrong code
        }),
      ).rejects.toThrowError(BadRequestError);
    });

    it("should not allow intent reuse after successful registration", async ({
      expect,
    }) => {
      const { registrationService } = await setup();

      const intent = await registrationService.createRegistrationIntent({
        email: "onetime@example.com",
        password: "SecurePassword123!",
      });

      // First completion should succeed
      await registrationService.completeRegistration({
        intentId: intent.intentId,
      });

      // Second attempt should fail (intent deleted)
      await expect(
        registrationService.completeRegistration({
          intentId: intent.intentId,
        }),
      ).rejects.toThrow(HttpError);
    });

    it("should detect race condition when email is taken during verification", async ({
      expect,
    }) => {
      const { registrationService, userService, userRealmProvider } =
        await setup();

      userRealmProvider.register("race-realm", {
        settings: {
          verifyEmailRequired: false,
        } as never,
      });

      // Create intent
      const intent = await registrationService.createRegistrationIntent(
        {
          email: "race@example.com",
          password: "SecurePassword123!",
        },
        "race-realm",
      );

      // Simulate another user registering with same email while verification pending
      await userService.users("race-realm").create({
        email: "race@example.com",
        username: "racewinner",
        roles: ["user"],
      });

      // Attempt to complete should fail
      await expect(
        registrationService.completeRegistration({
          intentId: intent.intentId,
        }),
      ).rejects.toThrowError(ConflictError);
    });

    it("should create credentials identity with hashed password", async ({
      expect,
    }) => {
      const { registrationService, sessionService, userRealmProvider } =
        await setup();

      const intent = await registrationService.createRegistrationIntent({
        email: "withpassword@example.com",
        password: "SecurePassword123!",
      });

      const user = await registrationService.completeRegistration({
        intentId: intent.intentId,
      });

      // Verify login works with the password
      const loggedInUser = await sessionService.login(
        "credentials",
        "withpassword@example.com",
        "SecurePassword123!",
      );

      expect(loggedInUser?.id).toBe(user.id);
    });

    it("should allow login with username after registration", async ({
      expect,
    }) => {
      const { registrationService, sessionService } = await setup({
        usernameEnabled: true,
      });

      const intent = await registrationService.createRegistrationIntent({
        email: "logintest@example.com",
        username: "loginuser",
        password: "SecurePassword123!",
      });

      const user = await registrationService.completeRegistration({
        intentId: intent.intentId,
      });

      // Verify login works with username
      const loggedInUser = await sessionService.login(
        "credentials",
        "loginuser",
        "SecurePassword123!",
      );

      expect(loggedInUser?.id).toBe(user.id);
    });
  });

  describe("Full registration flow integration", () => {
    it("should complete full registration flow without verification", async ({
      expect,
    }) => {
      const { registrationService, sessionService } = await setup({
        usernameEnabled: true,
      });

      // Phase 1: Create intent
      const intent = await registrationService.createRegistrationIntent({
        email: "fullflow@example.com",
        username: "fullflowuser",
        password: "SecurePassword123!",
        firstName: "Full",
        lastName: "Flow",
      });

      expect(intent.expectEmailVerification).toBe(false);
      expect(intent.expectPhoneVerification).toBe(false);

      // Phase 2: Complete registration
      const user = await registrationService.completeRegistration({
        intentId: intent.intentId,
      });

      expect(user.email).toBe("fullflow@example.com");
      expect(user.username).toBe("fullflowuser");

      // Verify user can login
      const session = await sessionService.login(
        "credentials",
        "fullflowuser",
        "SecurePassword123!",
      );
      expect(session?.id).toBe(user.id);
    });

    it("should complete full registration flow with email verification", async ({
      expect,
    }) => {
      const {
        registrationService,
        sessionService,
        emailProvider,
        userRealmProvider,
      } = await setup();

      userRealmProvider.register("full-verify-realm", {
        settings: {
          verifyEmailRequired: true,
        } as never,
      });

      // Phase 1: Create intent
      const intent = await registrationService.createRegistrationIntent(
        {
          email: "fullverify@example.com",
          password: "SecurePassword123!",
        },
        "full-verify-realm",
      );

      expect(intent.expectEmailVerification).toBe(true);

      // Extract verification code
      await expect.poll(() => emailProvider.records.length).toBe(1);
      const emailCode = extractCode(emailProvider.records[0].body);

      // Phase 2: Complete registration with code
      const user = await registrationService.completeRegistration({
        intentId: intent.intentId,
        emailCode,
      });

      expect(user.email).toBe("fullverify@example.com");
      expect(user.emailVerified).toBe(true);

      // Verify user can login
      const session = await sessionService.login(
        "credentials",
        "fullverify@example.com",
        "SecurePassword123!",
        "full-verify-realm",
      );
      expect(session?.id).toBe(user.id);
    });
  });
});
