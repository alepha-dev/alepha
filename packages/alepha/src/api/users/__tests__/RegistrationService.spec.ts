import { Alepha } from "alepha";
import { AlephaApiVerification } from "alepha/api/verifications";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity, CryptoProvider } from "alepha/security";
import { BadRequestError, ConflictError, HttpError } from "alepha/server";
import { describe, it } from "vitest";

import {
  AlephaApiUsers,
  RealmProvider,
  RegistrationService,
  SessionService,
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

  // Configure realm settings if provided (applies to default realm)
  if (realmSettings) {
    realmProvider.register("default", {
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
    realmProvider,
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
      const { registrationService, emailProvider, realmProvider } =
        await setup();

      // Register realm with email verification required
      realmProvider.register("verify-email-realm", {
        features: {
          notifications: true,
        },
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
      const { registrationService, realmProvider } = await setup();

      realmProvider.register("no-registration-realm", {
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
      const { registrationService, realmProvider } = await setup();

      realmProvider.register("username-required-realm", {
        settings: {
          username: "required",
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
      const { registrationService, realmProvider } = await setup();

      realmProvider.register("phone-required-realm", {
        settings: {
          phoneNumber: "required",
          email: "optional",
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
      const { registrationService, userService, realmProvider } = await setup();

      realmProvider.register("phone-realm", {
        settings: {
          phoneNumber: "optional",
          email: "optional",
        } as never,
      });

      // Create existing user with phone in the same realm
      await userService.users("phone-realm").create({
        realm: "phone-realm",
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
      const { registrationService } = await setup();

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
      const { registrationService, emailProvider, realmProvider } =
        await setup();

      realmProvider.register("email-verify-realm", {
        features: {
          notifications: true,
        },
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
      await dateTimeProvider.travel(11, "minutes");

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
      const { registrationService, realmProvider } = await setup();

      realmProvider.register("email-required-realm", {
        features: {
          notifications: true,
        },
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
      const { registrationService, realmProvider } = await setup();

      realmProvider.register("email-verify-realm", {
        features: {
          notifications: true,
        },
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
      const { registrationService, userService, realmProvider } = await setup();

      realmProvider.register("race-realm", {
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
        realm: "race-realm",
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
      const { registrationService, sessionService } = await setup();

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
        username: "optional",
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
        username: "optional",
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
        realmProvider,
      } = await setup();

      realmProvider.register("full-verify-realm", {
        features: {
          notifications: true,
        },
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

  describe("Password policy enforcement during registration", () => {
    it("should reject registration when password violates realm policy", async ({
      expect,
    }) => {
      const { registrationService, realmProvider } = await setup();

      realmProvider.register("strict-policy-realm", {
        settings: {
          passwordPolicy: {
            minLength: 10,
            requireUppercase: true,
            requireLowercase: false,
            requireNumbers: false,
            requireSpecialCharacters: false,
          },
        } as never,
      });

      await expect(
        registrationService.createRegistrationIntent(
          {
            email: "weakpass@example.com",
            password: "shortpw!",
          },
          "strict-policy-realm",
        ),
      ).rejects.toThrowError(BadRequestError);
    });

    it("should accept registration when password meets realm policy", async ({
      expect,
    }) => {
      const { registrationService, realmProvider } = await setup();

      realmProvider.register("strict-policy-realm", {
        settings: {
          passwordPolicy: {
            minLength: 10,
            requireUppercase: true,
            requireLowercase: false,
            requireNumbers: false,
            requireSpecialCharacters: false,
          },
        } as never,
      });

      const result = await registrationService.createRegistrationIntent(
        {
          email: "strongpass@example.com",
          password: "StrongPass123",
        },
        "strict-policy-realm",
      );

      expect(result.intentId).toBeDefined();
    });
  });

  describe("Registration rate limiting", () => {
    it("should check captcha before revealing whether an email exists", async ({
      expect,
    }) => {
      const { registrationService, userService } = await setup({
        captchaRequired: true,
      });

      await userService.users().create({
        username: "captchauser",
        email: "captcha-taken@example.com",
        roles: ["user"],
      });

      // Without a captcha, the caller must get the captcha error — not a
      // ConflictError that confirms the address is registered (enumeration).
      await expect(
        registrationService.createRegistrationIntent({
          username: "someone",
          email: "captcha-taken@example.com",
          password: "SecurePassword123!",
        }),
      ).rejects.toThrow(/captcha/i);
    });

    it("should hold the IP rate limit under a concurrent burst", async ({
      expect,
    }) => {
      const { alepha, registrationService } = await setup();

      await alepha.fork(async () => {
        alepha.store.set("alepha.http.request", { ip: "10.0.0.9" } as never);

        // 20 truly concurrent attempts against a limit of 10: a get-then-set
        // counter lets the whole burst through; an atomic incr admits at
        // most 10.
        const results = await Promise.allSettled(
          Array.from({ length: 20 }, (_, i) =>
            registrationService.createRegistrationIntent({
              email: `burst-${i}@example.com`,
              password: "SecurePassword123!",
            }),
          ),
        );

        const rateLimited = results.filter(
          (r) =>
            r.status === "rejected" &&
            String(r.reason).includes("Too many registration attempts"),
        );
        expect(rateLimited.length).toBeGreaterThanOrEqual(10);
      });
    });

    it("should rate limit registration attempts by IP", async ({ expect }) => {
      const { alepha, registrationService } = await setup();

      await alepha.fork(async () => {
        alepha.store.set("alepha.http.request", { ip: "10.0.0.1" } as never);

        // Make 10 registration attempts (they may fail for duplicate email, that's fine)
        for (let i = 0; i < 10; i++) {
          await registrationService
            .createRegistrationIntent({
              email: `ratelimit-${i}@example.com`,
              password: "SecurePassword123!",
            })
            .catch(() => {});
        }

        // 11th attempt should be rate limited
        await expect(
          registrationService.createRegistrationIntent({
            email: "ratelimit-overflow@example.com",
            password: "SecurePassword123!",
          }),
        ).rejects.toThrowError(BadRequestError);
      });
    });
  });

  describe("Default roles from realm settings", () => {
    it("should assign defaultRoles from realm settings to new users", async ({
      expect,
    }) => {
      const { registrationService, realmProvider } = await setup();

      realmProvider.register("custom-roles-realm", {
        settings: {
          defaultRoles: ["member", "viewer"],
        } as never,
      });

      const intent = await registrationService.createRegistrationIntent(
        {
          email: "roleuser@example.com",
          password: "SecurePassword123!",
        },
        "custom-roles-realm",
      );

      const user = await registrationService.completeRegistration({
        intentId: intent.intentId,
      });

      expect(user.roles).toEqual(["member", "viewer"]);
    });
  });

  describe("Cross-realm email uniqueness", () => {
    it("should allow same email in different realms", async ({ expect }) => {
      const { registrationService, userService, realmProvider } = await setup();

      realmProvider.register("realm-a");
      realmProvider.register("realm-b");

      // Create a user with this email in realm-a directly
      await userService.users("realm-a").create({
        realm: "realm-a",
        email: "shared@example.com",
        roles: ["user"],
      });

      // Register a new user with the same email in realm-b via registration flow
      const intent = await registrationService.createRegistrationIntent(
        {
          email: "shared@example.com",
          password: "SecurePassword123!",
        },
        "realm-b",
      );

      const user = await registrationService.completeRegistration({
        intentId: intent.intentId,
      });

      expect(user.email).toBe("shared@example.com");
    });
  });
});
