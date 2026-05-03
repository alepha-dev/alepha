import { Alepha } from "alepha";
import { CacheProvider, MemoryCacheProvider } from "alepha/cache";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import {
  AlephaSecurity,
  CryptoProvider,
  InvalidCredentialsError,
} from "alepha/security";
import { BadRequestError, UnauthorizedError } from "alepha/server";
import { describe, it } from "vitest";
import {
  AlephaApiUsers,
  RealmProvider,
  SessionService,
  UserService,
} from "../index.ts";

const setup = async (options?: {
  username?: "optional" | "required";
  brokenCache?: boolean;
}) => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error" },
  });

  if (options?.brokenCache) {
    class BrokenCacheProvider extends MemoryCacheProvider {
      public override async getTyped(): Promise<never> {
        throw new Error("Cache unavailable");
      }
      public override async setTyped(): Promise<never> {
        throw new Error("Cache unavailable");
      }
    }
    alepha.with({ provide: CacheProvider, use: BrokenCacheProvider });
  }

  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiUsers);

  await alepha.start();

  const sessionService = alepha.inject(SessionService);

  // Configure realm settings if provided
  if (options?.username) {
    const realmProvider = alepha.inject(RealmProvider);
    realmProvider.register("default", {
      settings: {
        username: options.username,
      } as never,
    });
  }

  return {
    alepha,
    sessionService,
    userService: alepha.inject(UserService),
    cryptoProvider: alepha.inject(CryptoProvider),
    identities: sessionService.identities(),
    dateTimeProvider: alepha.inject(DateTimeProvider),
  };
};

describe("alepha/api/users - SessionService.login", () => {
  it("should login successfully with valid credentials", async ({ expect }) => {
    const { sessionService, userService, cryptoProvider, identities } =
      await setup();

    // Create a test user
    const user = await userService.users().create({
      username: "loginsuccessuser",
      email: "login-success@example.com",
      roles: ["user"],
    });

    // Create identity with password
    const password = "securePassword123!";
    const hashedPassword = await cryptoProvider.hashPassword(password);

    await identities.create({
      provider: "local",
      providerUserId: "login-success@example.com",
      userId: user.id,
      password: hashedPassword,
    });

    // Test login
    const result = await sessionService.login(
      "local",
      "login-success@example.com",
      password,
    );

    expect(result?.id).toBe(user.id);
    expect(result?.email).toBe("login-success@example.com");
  });

  it("should throw InvalidCredentialsError when identity not found", async ({
    expect,
  }) => {
    const { sessionService } = await setup();

    await expect(
      sessionService.login("local", "nonexistent@example.com", "password"),
    ).rejects.toThrowError(InvalidCredentialsError);
  });

  it("should throw InvalidCredentialsError when password is invalid", async ({
    expect,
  }) => {
    const { sessionService, userService, cryptoProvider, identities } =
      await setup();

    // Create a test user
    const user = await userService.users().create({
      username: "invalidpassworduser",
      email: "invalid-password@example.com",
      roles: ["user"],
    });

    // Create identity with password
    const hashedPassword = await cryptoProvider.hashPassword("correctPassword");

    await identities.create({
      provider: "local",
      providerUserId: "invalid-password@example.com",
      userId: user.id,
      password: hashedPassword,
    });

    // Test login with wrong password
    await expect(
      sessionService.login(
        "local",
        "invalid-password@example.com",
        "wrongPassword",
      ),
    ).rejects.toThrowError(InvalidCredentialsError);
  });

  it("should throw InvalidCredentialsError when identity has no password configured", async ({
    expect,
  }) => {
    const { sessionService, userService, identities } = await setup();

    // Create a test user
    const user = await userService.users().create({
      username: "nopassworduser",
      email: "no-password@example.com",
      roles: ["user"],
    });

    // Create identity without password
    await identities.create({
      provider: "local",
      providerUserId: "no-password@example.com",
      userId: user.id,
      providerData: {}, // No password
    });

    await expect(
      sessionService.login("local", "no-password@example.com", "anyPassword"),
    ).rejects.toThrowError(InvalidCredentialsError);
  });

  it("should throw InvalidCredentialsError when user is deleted after identity creation", async ({
    expect,
  }) => {
    const { sessionService, userService, cryptoProvider, identities } =
      await setup();

    // Create a user, then delete them to simulate orphan identity
    const user = await userService.users().create({
      username: "orphanidentityuser",
      email: "orphan-identity@example.com",
      roles: ["user"],
    });

    const hashedPassword = await cryptoProvider.hashPassword("password123");

    await identities.create({
      provider: "local",
      providerUserId: "orphan-identity@example.com",
      userId: user.id,
      password: hashedPassword,
    });

    // Delete the user to create orphan identity scenario
    await userService.users().deleteById(user.id);

    await expect(
      sessionService.login(
        "local",
        "orphan-identity@example.com",
        "password123",
      ),
    ).rejects.toThrowError(InvalidCredentialsError);
  });

  it("should throw InvalidCredentialsError with same message for all failure types", async ({
    expect,
  }) => {
    const { sessionService, userService, cryptoProvider, identities } =
      await setup();

    // Setup for invalid password test
    const user = await userService.users().create({
      username: "sameerroruser",
      email: "same-error@example.com",
      roles: ["user"],
    });
    const hashedPassword = await cryptoProvider.hashPassword("correctPass");
    await identities.create({
      provider: "local",
      providerUserId: "same-error@example.com",
      userId: user.id,
      password: hashedPassword,
    });

    // Test identity not found
    try {
      await sessionService.login("local", "notfound@example.com", "password");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidCredentialsError);
      expect((error as Error).message).toBe("Invalid credentials");
    }

    // Test invalid password
    try {
      await sessionService.login(
        "local",
        "same-error@example.com",
        "wrongPassword",
      );
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidCredentialsError);
      expect((error as Error).message).toBe("Invalid credentials");
    }
  });

  it("should include random delay to prevent timing attacks", async ({
    expect,
  }) => {
    const { sessionService } = await setup();

    const start = Date.now();

    try {
      await sessionService.login(
        "local",
        "timing-attack@example.com",
        "password",
      );
    } catch {
      // Expected to fail
    }

    const elapsed = Date.now() - start;

    // Should take at least 50ms due to random delay
    expect(elapsed).toBeGreaterThanOrEqual(50);
  });

  it("should handle different providers correctly", async ({ expect }) => {
    const { sessionService, userService, cryptoProvider, identities } =
      await setup({ username: "optional" });

    const user = await userService.users().create({
      username: "multiprovideruser",
      email: "multi-provider@example.com",
      roles: ["user"],
    });

    // Create identity for 'custom' provider
    const hashedPassword = await cryptoProvider.hashPassword("customPass");
    await identities.create({
      provider: "custom",
      userId: user.id,
      password: hashedPassword,
    });

    // Login with correct provider
    const result = await sessionService.login(
      "custom",
      "multiprovideruser",
      "customPass",
    );
    expect(result?.id).toBe(user.id);

    // Should fail with wrong provider
    await expect(
      sessionService.login("local", "custom-user-id", "customPass"),
    ).rejects.toThrowError(InvalidCredentialsError);
  });

  it("should handle empty password correctly", async ({ expect }) => {
    const { sessionService, userService, cryptoProvider, identities } =
      await setup();

    const user = await userService.users().create({
      username: "emptypassworduser",
      email: "empty-password@example.com",
      roles: ["user"],
    });

    const hashedPassword = await cryptoProvider.hashPassword("realPassword");
    await identities.create({
      provider: "local",
      providerUserId: "empty-password@example.com",
      userId: user.id,
      password: hashedPassword,
    });

    // Empty password should fail
    await expect(
      sessionService.login("local", "empty-password@example.com", ""),
    ).rejects.toThrowError(InvalidCredentialsError);
  });

  it("should reject login for disabled user", async ({ expect }) => {
    const { sessionService, userService, cryptoProvider, identities } =
      await setup();

    const password = "disabledUserPass123!";
    const hashedPassword = await cryptoProvider.hashPassword(password);

    const user = await userService.users().create({
      username: "disableduser",
      email: "disabled@example.com",
      roles: ["user"],
      enabled: false,
    });

    await identities.create({
      provider: "local",
      providerUserId: "disabled@example.com",
      userId: user.id,
      password: hashedPassword,
    });

    await expect(
      sessionService.login("local", "disabled@example.com", password),
    ).rejects.toThrowError(InvalidCredentialsError);
  });

  describe("login rate limiting", () => {
    it("should block account after max failed attempts", async ({ expect }) => {
      const { sessionService, userService, cryptoProvider, identities } =
        await setup();

      const user = await userService.users().create({
        email: "ratelimit@example.com",
        roles: ["user"],
      });

      const hashedPassword = await cryptoProvider.hashPassword("correct");
      await identities.create({
        provider: "local",
        providerUserId: "ratelimit@example.com",
        userId: user.id,
        password: hashedPassword,
      });

      // Exhaust account limit (default: 5)
      for (let i = 0; i < 5; i++) {
        await expect(
          sessionService.login("local", "ratelimit@example.com", "wrong"),
        ).rejects.toThrowError(InvalidCredentialsError);
      }

      // 6th attempt with CORRECT password should still be blocked
      await expect(
        sessionService.login("local", "ratelimit@example.com", "correct"),
      ).rejects.toThrowError(InvalidCredentialsError);
    });

    it("should allow login after lockout window expires", async ({
      expect,
    }) => {
      const {
        sessionService,
        userService,
        cryptoProvider,
        identities,
        dateTimeProvider,
      } = await setup();

      const user = await userService.users().create({
        email: "ratelimit-expire@example.com",
        roles: ["user"],
      });

      const hashedPassword = await cryptoProvider.hashPassword("correct");
      await identities.create({
        provider: "local",
        providerUserId: "ratelimit-expire@example.com",
        userId: user.id,
        password: hashedPassword,
      });

      // Exhaust account limit
      for (let i = 0; i < 5; i++) {
        await expect(
          sessionService.login(
            "local",
            "ratelimit-expire@example.com",
            "wrong",
          ),
        ).rejects.toThrowError(InvalidCredentialsError);
      }

      // Advance past window (15 min + 1s)
      await dateTimeProvider.travel(16 * 60 * 1000);

      // Should succeed now
      const result = await sessionService.login(
        "local",
        "ratelimit-expire@example.com",
        "correct",
      );
      expect(result.id).toBe(user.id);
    });

    it("should not increment counter on successful login", async ({
      expect,
    }) => {
      const { sessionService, userService, cryptoProvider, identities } =
        await setup();

      const user = await userService.users().create({
        email: "ratelimit-success@example.com",
        roles: ["user"],
      });

      const hashedPassword = await cryptoProvider.hashPassword("correct");
      await identities.create({
        provider: "local",
        providerUserId: "ratelimit-success@example.com",
        userId: user.id,
        password: hashedPassword,
      });

      // Login successfully 10 times — should never be blocked
      for (let i = 0; i < 10; i++) {
        const result = await sessionService.login(
          "local",
          "ratelimit-success@example.com",
          "correct",
        );
        expect(result.id).toBe(user.id);
      }
    });

    it("should isolate account lockout per realm", async ({ expect }) => {
      const {
        sessionService,
        userService,
        cryptoProvider,
        identities,
        alepha,
      } = await setup();

      // All realms share default repositories (same DB tables)
      const realmProvider = alepha.inject(RealmProvider);
      realmProvider.register("realm-a");
      realmProvider.register("realm-b");

      const userA = await userService.users("realm-a").create({
        realm: "realm-a",
        email: "same@example.com",
        roles: ["user"],
      });

      const userB = await userService.users("realm-b").create({
        realm: "realm-b",
        email: "same@example.com",
        roles: ["user"],
      });

      const hashedPassword = await cryptoProvider.hashPassword("correct");

      await identities.create({
        provider: "local",
        providerUserId: "same-realm-a@example.com",
        userId: userA.id,
        password: hashedPassword,
      });

      // Exhaust realm-a account limit
      for (let i = 0; i < 5; i++) {
        await expect(
          sessionService.login("local", "same@example.com", "wrong", "realm-a"),
        ).rejects.toThrowError(InvalidCredentialsError);
      }

      // realm-b should NOT be blocked (different account key: login:account:realm-b:userB.id)
      await identities.create({
        provider: "local",
        providerUserId: "same-realm-b@example.com",
        userId: userB.id,
        password: hashedPassword,
      });

      const result = await sessionService.login(
        "local",
        "same@example.com",
        "correct",
        "realm-b",
      );
      expect(result.id).toBe(userB.id);
    });

    it("should block IP after max failed attempts across different accounts", async ({
      expect,
    }) => {
      const {
        sessionService,
        userService,
        cryptoProvider,
        identities,
        alepha,
      } = await setup();

      const hashedPassword = await cryptoProvider.hashPassword("correct");

      // Create 3 different users
      for (let i = 0; i < 3; i++) {
        const user = await userService.users().create({
          email: `iptest-${i}@example.com`,
          roles: ["user"],
        });
        await identities.create({
          provider: "local",
          providerUserId: `iptest-${i}@example.com`,
          userId: user.id,
          password: hashedPassword,
        });
      }

      // Set up IP in request context
      await alepha.fork(async () => {
        alepha.store.set("alepha.http.request", { ip: "1.2.3.4" } as never);

        // Fail 15 times across different accounts (5 per account)
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 5; j++) {
            await expect(
              sessionService.login("local", `iptest-${i}@example.com`, "wrong"),
            ).rejects.toThrowError(InvalidCredentialsError);
          }
        }

        // 16th attempt — IP should be blocked even with correct credentials
        await expect(
          sessionService.login("local", "iptest-0@example.com", "correct"),
        ).rejects.toThrowError(InvalidCredentialsError);
      });
    });

    it("should skip IP check when no HTTP context", async ({ expect }) => {
      const { sessionService, userService, cryptoProvider, identities } =
        await setup();

      const user = await userService.users().create({
        email: "nohttp@example.com",
        roles: ["user"],
      });

      const hashedPassword = await cryptoProvider.hashPassword("correct");
      await identities.create({
        provider: "local",
        providerUserId: "nohttp@example.com",
        userId: user.id,
        password: hashedPassword,
      });

      // No HTTP request in ALS — IP check skipped, only account check applies
      // Fail 4 times (under account limit of 5) then succeed
      for (let i = 0; i < 4; i++) {
        await expect(
          sessionService.login("local", "nohttp@example.com", "wrong"),
        ).rejects.toThrowError(InvalidCredentialsError);
      }

      const result = await sessionService.login(
        "local",
        "nohttp@example.com",
        "correct",
      );
      expect(result.id).toBe(user.id);
    });

    it("should proceed with login when cache is unavailable", async ({
      expect,
    }) => {
      const { sessionService, userService, cryptoProvider, identities } =
        await setup({ brokenCache: true });

      const user = await userService.users().create({
        email: "cachefail@example.com",
        roles: ["user"],
      });

      const hashedPassword = await cryptoProvider.hashPassword("correct");
      await identities.create({
        provider: "local",
        providerUserId: "cachefail@example.com",
        userId: user.id,
        password: hashedPassword,
      });

      // Login should still succeed (fail-open)
      const result = await sessionService.login(
        "local",
        "cachefail@example.com",
        "correct",
      );
      expect(result.id).toBe(user.id);
    });

    it("should apply partial realm settings with defaults", async ({
      expect,
    }) => {
      const {
        sessionService,
        userService,
        cryptoProvider,
        identities,
        alepha,
      } = await setup();

      // Register realm with only accountMaxAttempts overridden
      const realmProvider = alepha.inject(RealmProvider);
      realmProvider.register("strict", {
        settings: {
          loginRateLimit: { accountMaxAttempts: 2 },
        } as never,
      });

      const user = await userService.users("strict").create({
        realm: "strict",
        email: "strict@example.com",
        roles: ["user"],
      });

      const hashedPassword = await cryptoProvider.hashPassword("correct");
      await identities.create({
        provider: "local",
        providerUserId: "strict@example.com",
        userId: user.id,
        password: hashedPassword,
      });

      // Only 2 failures should lock the account
      for (let i = 0; i < 2; i++) {
        await expect(
          sessionService.login(
            "local",
            "strict@example.com",
            "wrong",
            "strict",
          ),
        ).rejects.toThrowError(InvalidCredentialsError);
      }

      await expect(
        sessionService.login(
          "local",
          "strict@example.com",
          "correct",
          "strict",
        ),
      ).rejects.toThrowError(InvalidCredentialsError);
    });

    it("should extend lockout on new failures (sliding window)", async ({
      expect,
    }) => {
      const {
        sessionService,
        userService,
        cryptoProvider,
        identities,
        dateTimeProvider,
      } = await setup();

      const user = await userService.users().create({
        email: "sliding@example.com",
        roles: ["user"],
      });

      const hashedPassword = await cryptoProvider.hashPassword("correct");
      await identities.create({
        provider: "local",
        providerUserId: "sliding@example.com",
        userId: user.id,
        password: hashedPassword,
      });

      // Fail 4 times
      for (let i = 0; i < 4; i++) {
        await expect(
          sessionService.login("local", "sliding@example.com", "wrong"),
        ).rejects.toThrowError(InvalidCredentialsError);
      }

      // Advance 10 minutes (still inside 15min window)
      await dateTimeProvider.travel(10 * 60 * 1000);

      // 5th failure — triggers lockout, TTL refreshes from NOW
      await expect(
        sessionService.login("local", "sliding@example.com", "wrong"),
      ).rejects.toThrowError(InvalidCredentialsError);

      // Advance 10 more minutes (20min total from first, but only 10min from last failure)
      await dateTimeProvider.travel(10 * 60 * 1000);

      // Should STILL be locked — TTL was refreshed on the 5th failure
      await expect(
        sessionService.login("local", "sliding@example.com", "correct"),
      ).rejects.toThrowError(InvalidCredentialsError);

      // Advance past the remaining window
      await dateTimeProvider.travel(6 * 60 * 1000);

      // Now should succeed
      const result = await sessionService.login(
        "local",
        "sliding@example.com",
        "correct",
      );
      expect(result.id).toBe(user.id);
    });
  });
});

describe("alepha/api/users - SessionService.link", () => {
  it("should reject OAuth2 account creation when registration is disabled", async ({
    expect,
  }) => {
    const { sessionService, alepha } = await setup();

    const realmProvider = alepha.inject(RealmProvider);
    realmProvider.register("closed", {
      settings: {
        registrationAllowed: false,
      } as never,
    });

    await expect(
      sessionService.link(
        "google",
        {
          sub: "google-123",
          email: "newuser@example.com",
          name: "New User",
        },
        "closed",
      ),
    ).rejects.toThrowError(BadRequestError);
  });

  it("should allow OAuth2 login for existing users when registration is disabled", async ({
    expect,
  }) => {
    const { sessionService, userService, alepha } = await setup();

    const realmProvider = alepha.inject(RealmProvider);
    realmProvider.register("closed", {
      settings: {
        registrationAllowed: false,
      } as never,
    });

    // Create existing user and identity
    const user = await userService.users("closed").create({
      realm: "closed",
      email: "existing@example.com",
      roles: ["user"],
    });

    await sessionService.identities("closed").create({
      provider: "google",
      providerUserId: "google-existing",
      userId: user.id,
    });

    // Existing identity should still work
    const result = await sessionService.link(
      "google",
      {
        sub: "google-existing",
        email: "existing@example.com",
        name: "Existing User",
      },
      "closed",
    );

    expect(result.id).toBe(user.id);
  });

  it("should refuse auto-link when OAuth provider says email_verified is false", async ({
    expect,
  }) => {
    const { sessionService, userService } = await setup();

    await userService.users().create({
      username: "verifieduser",
      email: "verified@example.com",
      roles: ["user"],
    });

    await expect(
      sessionService.link("google", {
        sub: "google-unverified",
        email: "verified@example.com",
        name: "Unverified User",
        email_verified: false,
      }),
    ).rejects.toThrowError(BadRequestError);
  });

  it("should allow auto-link when email_verified is true or undefined", async ({
    expect,
  }) => {
    const { sessionService, userService } = await setup();

    const user = await userService.users().create({
      username: "linkableuser",
      email: "linkable@example.com",
      roles: ["user"],
    });

    const result = await sessionService.link("google", {
      sub: "google-verified",
      email: "linkable@example.com",
      name: "Verified User",
      email_verified: true,
    });

    expect(result.id).toBe(user.id);
  });

  it("should use defaultRoles from realm settings for new OAuth users", async ({
    expect,
  }) => {
    const { sessionService, alepha } = await setup();

    const realmProvider = alepha.inject(RealmProvider);
    realmProvider.register("custom-roles", {
      settings: {
        registrationAllowed: true,
        defaultRoles: ["member", "viewer"],
      } as never,
    });

    const result = await sessionService.link(
      "google",
      {
        sub: "google-newuser-roles",
        email: "newuser-roles@example.com",
        name: "New Role User",
      },
      "custom-roles",
    );

    expect("roles" in result && result.roles).toEqual(["member", "viewer"]);
  });
});

describe("alepha/api/users - SessionService.refreshSession", () => {
  it("should reject refresh for disabled user and delete session", async ({
    expect,
  }) => {
    const { sessionService, userService, cryptoProvider, identities } =
      await setup();

    const password = "refreshDisabledPass!";
    const hashedPassword = await cryptoProvider.hashPassword(password);

    const user = await userService.users().create({
      username: "refreshdisableduser",
      email: "refresh-disabled@example.com",
      roles: ["user"],
    });

    await identities.create({
      provider: "local",
      providerUserId: "refresh-disabled@example.com",
      userId: user.id,
      password: hashedPassword,
    });

    // Login to get a session with refresh token
    await sessionService.login(
      "local",
      "refresh-disabled@example.com",
      password,
    );

    const { refreshToken } = await sessionService.createSession(user, 3600);

    // Disable the user
    await userService.users().updateById(user.id, { enabled: false });

    // Refresh should fail with UnauthorizedError
    await expect(
      sessionService.refreshSession(refreshToken),
    ).rejects.toThrowError(UnauthorizedError);

    // Session should be deleted — a second refresh should also fail
    await expect(
      sessionService.refreshSession(refreshToken),
    ).rejects.toThrowError();
  });

  describe("refresh-token idle timeout", () => {
    it("should refresh successfully when used within the idle window", async ({
      expect,
    }) => {
      const { sessionService, userService, alepha, dateTimeProvider } =
        await setup();

      const realmProvider = alepha.inject(RealmProvider);
      realmProvider.register("idle-ok", {
        settings: {
          refreshToken: { expirationIdle: 60 * 60 * 1000 }, // 1 hour
        } as never,
      });

      const user = await userService.users("idle-ok").create({
        realm: "idle-ok",
        email: "idle-ok@example.com",
        roles: ["user"],
      });

      const { refreshToken } = await sessionService.createSession(
        user,
        24 * 3600,
        "idle-ok",
      );

      // Half the idle window — still well inside.
      await dateTimeProvider.travel(30, "minutes");

      const result = await sessionService.refreshSession(
        refreshToken,
        "idle-ok",
      );
      expect(result.user.id).toBe(user.id);
    });

    it("should reject refresh and delete session when idle window is exceeded", async ({
      expect,
    }) => {
      const { sessionService, userService, alepha, dateTimeProvider } =
        await setup();

      const realmProvider = alepha.inject(RealmProvider);
      realmProvider.register("idle-strict", {
        settings: {
          refreshToken: { expirationIdle: 5 * 60 * 1000 }, // 5 minutes
        } as never,
      });

      const user = await userService.users("idle-strict").create({
        realm: "idle-strict",
        email: "idle-strict@example.com",
        roles: ["user"],
      });

      const { refreshToken } = await sessionService.createSession(
        user,
        7 * 24 * 3600, // 7 day absolute expiry — well beyond idle threshold
        "idle-strict",
      );

      // Idle past the threshold (but absolute expiry is still days away).
      await dateTimeProvider.travel(10, "minutes");

      await expect(
        sessionService.refreshSession(refreshToken, "idle-strict"),
      ).rejects.toThrowError(UnauthorizedError);

      // Session deleted — second refresh fails too (row gone).
      await expect(
        sessionService.refreshSession(refreshToken, "idle-strict"),
      ).rejects.toThrowError();
    });

    it("should not enforce idle when expirationIdle is undefined (default)", async ({
      expect,
    }) => {
      const { sessionService, userService, dateTimeProvider } = await setup();

      const user = await userService.users().create({
        username: "idle-defaultuser",
        email: "idle-default@example.com",
        roles: ["user"],
      });

      const { refreshToken } = await sessionService.createSession(
        user,
        7 * 24 * 3600,
      );

      // Travel days into the future. With no idleTtl configured, refresh
      // should still succeed (only absolute expiresAt matters).
      await dateTimeProvider.travel(3, "days");

      const result = await sessionService.refreshSession(refreshToken);
      expect(result.user.id).toBe(user.id);
    });
  });
});
