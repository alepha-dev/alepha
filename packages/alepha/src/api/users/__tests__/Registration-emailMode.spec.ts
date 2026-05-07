import { Alepha } from "alepha";
import { AlephaApiVerification } from "alepha/api/verifications";
import { AlephaEmail, MemoryEmailProvider } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { BadRequestError } from "alepha/server";
import { describe, expect, it } from "vitest";
import {
  AlephaApiUsers,
  RealmProvider,
  RegistrationService,
  UserNotifications,
  UserService,
} from "../index.ts";

const setup = async (
  realmName: string,
  realmSettings?: Record<string, unknown>,
) => {
  const alepha = Alepha.create();
  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiVerification);
  alepha.with(AlephaApiUsers);
  alepha.with(UserNotifications);
  await alepha.start();

  const realmProvider = alepha.inject(RealmProvider);
  if (realmSettings) {
    realmProvider.register(realmName, {
      settings: realmSettings as never,
    });
  }

  // Wipe between cases.
  await realmProvider.userRepository(realmName).deleteMany({});
  alepha.inject(MemoryEmailProvider).records = [];

  return {
    alepha,
    registrationService: alepha.inject(RegistrationService),
    userService: alepha.inject(UserService),
    realmProvider,
  };
};

// ---------------------------------------------------------------------------------------------------------------------

describe("RegistrationService — username: 'email' mode", () => {
  it("derives the username from the email and ignores any client-sent value", async () => {
    const { registrationService, userService } = await setup("email-mode-1", {
      username: "email",
    });

    const intent = await registrationService.createRegistrationIntent(
      {
        email: "ni.foures+testkv@gmail.com",
        password: "SecurePassword123!",
        // The client sneaks a custom username into the request — server
        // must drop it on the floor and use the slugger.
        username: "i-am-the-admin" as never,
      },
      "email-mode-1",
    );

    const user = await registrationService.completeRegistration({
      intentId: intent.intentId,
    });

    // Slug rule: gmail "+suffix" preserved, dots → "-".
    expect(user.username).toBe("ni-foures-testkv");

    const reloaded = await userService
      .users("email-mode-1")
      .findOne({ where: { email: { eq: "ni.foures+testkv@gmail.com" } } });
    expect(reloaded?.username).toBe("ni-foures-testkv");
  });

  it("appends a 4-char random suffix on collision instead of failing", async () => {
    const { registrationService, userService } = await setup("email-mode-2", {
      username: "email",
    });

    // First user takes the slug.
    await userService.users("email-mode-2").create({
      realm: "email-mode-2",
      username: "alice",
      email: "preexisting@example.com",
      roles: ["user"],
    });

    const intent = await registrationService.createRegistrationIntent(
      {
        email: "alice@example.com",
        password: "SecurePassword123!",
      },
      "email-mode-2",
    );
    const created = await registrationService.completeRegistration({
      intentId: intent.intentId,
    });

    expect(created.username).toMatch(/^alice-[a-z0-9]{4}$/);
  });

  it("rejects email-mode when no email is provided", async () => {
    const { registrationService } = await setup("email-mode-3", {
      username: "email",
      email: "optional",
    });

    await expect(
      registrationService.createRegistrationIntent(
        {
          password: "SecurePassword123!",
        },
        "email-mode-3",
      ),
    ).rejects.toThrowError(BadRequestError);
  });

  it("blocklist applies even though the client never sees the field", async () => {
    const { registrationService } = await setup("email-mode-blocklist", {
      username: "email",
      usernameBlocklist: ["admin"],
    });

    const intent = await registrationService.createRegistrationIntent(
      {
        email: "admin@example.com",
        password: "SecurePassword123!",
      },
      "email-mode-blocklist",
    );
    const user = await registrationService.completeRegistration({
      intentId: intent.intentId,
    });

    // Slug "admin" is blocked → falls through to the suffix path.
    expect(user.username).not.toBe("admin");
    expect(user.username).toMatch(/^admin-[a-z0-9]{4}$/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("RegistrationService — blocklist applies in 'required' mode too", () => {
  it("rejects a manual username that hits the blocklist", async () => {
    const { registrationService } = await setup("manual-mode", {
      username: "required",
      usernameBlocklist: ["admin"],
    });

    await expect(
      registrationService.createRegistrationIntent(
        {
          username: "admin",
          email: "someone@example.com",
          password: "SecurePassword123!",
        },
        "manual-mode",
      ),
    ).rejects.toThrowError(BadRequestError);
  });

  it("blocklist match is case-insensitive in manual mode", async () => {
    const { registrationService } = await setup("manual-case", {
      username: "required",
      usernameBlocklist: ["Admin"],
    });

    await expect(
      registrationService.createRegistrationIntent(
        {
          username: "ADMIN",
          email: "someone@example.com",
          password: "SecurePassword123!",
        },
        "manual-case",
      ),
    ).rejects.toThrowError(BadRequestError);
  });

  it("default (empty) blocklist does not reject special names", async () => {
    const { registrationService } = await setup("manual-empty", {
      username: "required",
    });

    const intent = await registrationService.createRegistrationIntent(
      {
        username: "admin",
        email: "admin-empty@example.com",
        password: "SecurePassword123!",
      },
      "manual-empty",
    );
    const created = await registrationService.completeRegistration({
      intentId: intent.intentId,
    });
    expect(created.username).toBe("admin");
  });
});
