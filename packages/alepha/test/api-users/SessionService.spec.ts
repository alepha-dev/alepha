import { Alepha } from "alepha";
import { AlephaApiUsers, SessionService, UserService } from "alepha/api/users";
import {
  AlephaSecurity,
  CryptoProvider,
  InvalidCredentialsError,
} from "alepha/security";
import { describe, it } from "vitest";

const setup = async (options?: { usernameEnabled?: boolean }) => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error" },
  });

  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiUsers);

  await alepha.start();

  const sessionService = alepha.inject(SessionService);

  // Configure realm settings if provided
  if (options?.usernameEnabled) {
    const { UserRealmProvider } = await import(
      "../../src/api-users/providers/UserRealmProvider.ts"
    );
    const userRealmProvider = alepha.inject(UserRealmProvider);
    userRealmProvider.register("default", {
      settings: {
        usernameEnabled: true,
      } as never,
    });
  }

  return {
    alepha,
    sessionService,
    userService: alepha.inject(UserService),
    cryptoProvider: alepha.inject(CryptoProvider),
    identities: sessionService.identities(),
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
      await setup({ usernameEnabled: true });

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
});
