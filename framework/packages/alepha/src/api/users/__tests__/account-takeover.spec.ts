import { Alepha } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { AlephaSecurity, CryptoProvider } from "alepha/security";
import { describe, it } from "vitest";

import {
  AdminUserController,
  AlephaApiUsers,
  MfaService,
  MyAccountController,
  MyIdentityController,
  MyMfaController,
  MyPasswordController,
  MyProfileController,
  RealmProvider,
  RegistrationService,
  SessionService,
  TotpService,
} from "../index.ts";

const PASSWORD = "Correct-Horse-Battery-1";
const OTHER_PASSWORD = "Another-Horse-Battery-2";
const url = new URL("https://app.example/");

const tag = () => Math.random().toString(36).slice(2, 8);

const boot = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(AlephaOrmTestPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiUsers);
  await alepha.start();
  return alepha;
};

/**
 * An account of realm `users`, with a password when asked, and the context a
 * controller is called with for it.
 */
const account = async (
  alepha: Alepha,
  options: { password?: boolean; oauth?: boolean; email?: string } = {},
) => {
  const realmProvider = alepha.inject(RealmProvider);
  const t = tag();
  const email = options.email ?? `acct-${t}@example.com`;
  const user = await realmProvider
    .userRepository()
    .create({ email, username: `acct${t}`, roles: ["user"] });
  const credentials =
    options.password === false
      ? undefined
      : await realmProvider.identityRepository().create({
          provider: "credentials",
          userId: user.id,
          password: await alepha.inject(CryptoProvider).hashPassword(PASSWORD),
        });
  const oauth = options.oauth
    ? await realmProvider.identityRepository().create({
        provider: "github",
        userId: user.id,
        providerUserId: `gh-${t}`,
      })
    : undefined;
  const { sessionId } = await alepha
    .inject(SessionService)
    .createSession(user as never, 3600);
  return {
    user,
    email,
    credentials,
    oauth,
    sessionId,
    context: {
      user: { id: user.id, realm: "users", sessionId },
      url,
    } as never,
  };
};

const sessionsOf = (alepha: Alepha, userId: string) =>
  alepha
    .inject(RealmProvider)
    .sessionRepository()
    .findMany({ where: { userId: { eq: userId } } });

describe("alepha/api/users - account takeover guards", () => {
  describe("provider sign-in across realms", () => {
    it("does not sign a provider account of one realm into another realm", async ({
      expect,
    }) => {
      const alepha = await boot();
      const realmProvider = alepha.inject(RealmProvider);
      realmProvider.register("tenant-a");
      realmProvider.register("tenant-b", {
        settings: { registrationAllowed: false },
      });
      const sessions = alepha.inject(SessionService);
      const sub = `g-${tag()}`;
      const profile = {
        sub,
        email: `x-${tag()}@example.com`,
        email_verified: true,
      };

      const a = await sessions.link("google", profile, "tenant-a");
      expect(a.realm).toBe("tenant-a");

      await expect(
        sessions.link("google", profile, "tenant-b"),
      ).rejects.toThrow("Account doesn't exist");

      // The realm it belongs to still signs it in.
      const again = await sessions.link("google", profile, "tenant-a");
      expect(again.id).toBe(a.id);
    });
  });

  describe("provider sign-in onto an unverified account", () => {
    it("removes the sign-in methods and sessions of whoever registered the address first", async ({
      expect,
    }) => {
      const alepha = await boot();
      const realmProvider = alepha.inject(RealmProvider);
      const sessions = alepha.inject(SessionService);
      const registration = alepha.inject(RegistrationService);
      const email = `victim-${tag()}@example.com`;
      // A stranger registers the victim's address with a password of theirs.
      const intent = await registration.createRegistrationIntent({
        email,
        password: PASSWORD,
      });
      const squatted = await registration.completeRegistration({
        intentId: intent.intentId,
      });
      expect(squatted.emailVerified).toBe(false);
      await sessions.createSession(squatted as never, 3600);

      // The owner signs in with a provider that vouches for the address.
      const owner = await sessions.link("google", {
        sub: `g-${tag()}`,
        email,
        email_verified: true,
      });

      expect(owner.id).toBe(squatted.id);
      expect(owner.emailVerified).toBe(true);
      await expect(
        sessions.login("credentials", email, PASSWORD),
      ).rejects.toThrow();
      expect(await sessionsOf(alepha, squatted.id)).toHaveLength(0);
      const left = await realmProvider
        .identityRepository()
        .findMany({ where: { userId: { eq: squatted.id } } });
      expect(left.map((it) => it.provider)).toEqual(["google"]);
    });

    it("keeps the password of an account whose address is verified", async ({
      expect,
    }) => {
      const alepha = await boot();
      const sessions = alepha.inject(SessionService);
      const { user, email } = await account(alepha);
      await alepha
        .inject(RealmProvider)
        .userRepository()
        .updateById(user.id, { emailVerified: true });

      const linked = await sessions.link("google", {
        sub: `g-${tag()}`,
        email,
        email_verified: true,
      });

      expect(linked.id).toBe(user.id);
      const again = await sessions.login("credentials", email, PASSWORD);
      expect(again.id).toBe(user.id);
      expect(await sessionsOf(alepha, user.id)).toHaveLength(1);
    });
  });

  describe("adminEmails", () => {
    it("does not promote a credentials account whose address was never verified", async ({
      expect,
    }) => {
      const alepha = await boot();
      const realmProvider = alepha.inject(RealmProvider);
      const email = `boss-${tag()}@example.com`;
      realmProvider.register("users", { settings: { adminEmails: [email] } });
      const registration = alepha.inject(RegistrationService);
      const sessions = alepha.inject(SessionService);

      const intent = await registration.createRegistrationIntent({
        email,
        password: PASSWORD,
      });
      const user = await registration.completeRegistration({
        intentId: intent.intentId,
      });
      expect(user.emailVerified).toBe(false);

      const loggedIn = await sessions.login("credentials", email, PASSWORD);
      expect(loggedIn.roles).not.toContain("admin");

      // Once the address is verified, the same sign-in promotes.
      await realmProvider
        .userRepository()
        .updateById(user.id, { emailVerified: true });
      const verified = await sessions.login("credentials", email, PASSWORD);
      expect(verified.roles).toContain("admin");
    });

    it("does not let an unverified provider address through a closed realm", async ({
      expect,
    }) => {
      const alepha = await boot();
      const realmProvider = alepha.inject(RealmProvider);
      const email = `ceo-${tag()}@example.com`;
      realmProvider.register("closed", {
        settings: { registrationAllowed: false, adminEmails: [email] },
      });
      // A closed realm holding no admin stays closed for this test.
      await realmProvider
        .userRepository("closed")
        .create({ realm: "closed", email: `first-${tag()}@example.com` });
      const sessions = alepha.inject(SessionService);

      await expect(
        sessions.link(
          "github",
          { sub: `gh-${tag()}`, email, email_verified: false },
          "closed",
        ),
      ).rejects.toThrow("Account doesn't exist");
      expect(
        await realmProvider
          .userRepository("closed")
          .findOne({ where: { realm: "closed", email } }),
      ).toBeUndefined();

      // The provider vouching for the address is what opens the door.
      const admin = await sessions.link(
        "github",
        { sub: `gh-${tag()}`, email, email_verified: true },
        "closed",
      );
      expect(admin.roles).toContain("admin");
    });

    it("does not promote an unverified provider address on an open realm", async ({
      expect,
    }) => {
      const alepha = await boot();
      const realmProvider = alepha.inject(RealmProvider);
      const email = `cto-${tag()}@example.com`;
      realmProvider.register("users", { settings: { adminEmails: [email] } });

      const user = await alepha
        .inject(SessionService)
        .link("github", { sub: `gh-${tag()}`, email, email_verified: false });

      expect(user.emailVerified).toBe(false);
      expect(user.roles).not.toContain("admin");
    });
  });

  describe("adminUsernames", () => {
    it("refuses a rename into a reserved admin username", async ({
      expect,
    }) => {
      const alepha = await boot();
      const boss = `boss${tag()}`;
      alepha.inject(RealmProvider).register("users", {
        settings: { username: "optional", adminUsernames: [boss] },
      });
      const { user, context } = await account(alepha);
      const { refreshToken } = await alepha
        .inject(SessionService)
        .createSession(user as never, 3600);

      await expect(
        alepha
          .inject(MyProfileController)
          .updateMyProfile({ body: { username: boss.toUpperCase() } }, context),
      ).rejects.toThrow("This username is not available");

      const refreshed = await alepha
        .inject(SessionService)
        .refreshSession(refreshToken);
      expect(refreshed.user.roles).not.toContain("admin");
    });

    it("refuses a username change on a realm that has no usernames", async ({
      expect,
    }) => {
      const alepha = await boot();
      alepha
        .inject(RealmProvider)
        .register("users", { settings: { username: "none" } });
      const { user, context } = await account(alepha);

      await expect(
        alepha
          .inject(MyProfileController)
          .updateMyProfile({ body: { username: `free${tag()}` } }, context),
      ).rejects.toThrow("Usernames are not used on this realm");

      // Names still change.
      const profile = await alepha
        .inject(MyProfileController)
        .updateMyProfile({ body: { firstName: "Ada" } }, context);
      expect(profile.firstName).toBe("Ada");
      expect(profile.username).toBe(user.username);
    });
  });

  describe("a session alone does not replace the password", () => {
    it("asks for the current password to remove the password", async ({
      expect,
    }) => {
      const alepha = await boot();
      alepha
        .inject(RealmProvider)
        .register("users", { settings: { username: "optional" } });
      const { user, credentials, sessionId, context } = await account(alepha, {
        oauth: true,
      });
      await alepha.inject(SessionService).createSession(user as never, 3600);
      const identities = alepha.inject(MyIdentityController);
      const passwords = alepha.inject(MyPasswordController);

      // Not through the unlink route, which takes no proof.
      await expect(
        identities.unlinkMyIdentity(
          { params: { id: credentials!.id } },
          context,
        ),
      ).rejects.toThrow("Removing the password asks for it");
      await expect(
        passwords.removeMyPassword(
          { body: { currentPassword: "not-the-password" } },
          context,
        ),
      ).rejects.toThrow("Current password is incorrect");

      // The chain the missing proof allowed: the password is still there, so
      // a "first" password is refused and the owner's password still works.
      await expect(
        identities.setMyFirstPassword(
          { body: { password: OTHER_PASSWORD } },
          context,
        ),
      ).rejects.toThrow("already has a password");
      await expect(
        alepha
          .inject(SessionService)
          .login("credentials", user.username!, OTHER_PASSWORD),
      ).rejects.toThrow();

      const done = await passwords.removeMyPassword(
        { body: { currentPassword: PASSWORD } },
        context,
      );
      expect(done.otherSessionsRevoked).toBe(1);
      expect((await sessionsOf(alepha, user.id)).map((it) => it.id)).toEqual([
        sessionId,
      ]);
    });

    it("never removes the password that is the last way to sign in", async ({
      expect,
    }) => {
      const alepha = await boot();
      const { context } = await account(alepha);

      await expect(
        alepha
          .inject(MyPasswordController)
          .removeMyPassword({ body: { currentPassword: PASSWORD } }, context),
      ).rejects.toThrow("only way to sign in");
    });

    it("still unlinks a provider identity without proof", async ({
      expect,
    }) => {
      const alepha = await boot();
      const { oauth, context } = await account(alepha, { oauth: true });

      const done = await alepha
        .inject(MyIdentityController)
        .unlinkMyIdentity({ params: { id: oauth!.id } }, context);

      expect(done.ok).toBe(true);
    });

    it("signs the other sessions out when a first password is set", async ({
      expect,
    }) => {
      const alepha = await boot();
      const { user, sessionId, context } = await account(alepha, {
        password: false,
        oauth: true,
      });
      await alepha.inject(SessionService).createSession(user as never, 3600);
      expect(await sessionsOf(alepha, user.id)).toHaveLength(2);

      await alepha
        .inject(MyIdentityController)
        .setMyFirstPassword({ body: { password: OTHER_PASSWORD } }, context);

      const left = await sessionsOf(alepha, user.id);
      expect(left.map((it) => it.id)).toEqual([sessionId]);
    });
  });

  describe("TOTP enrolment", () => {
    const pending = async (options: {
      password?: boolean;
      oauth?: boolean;
    }) => {
      const alepha = await boot();
      alepha.inject(RealmProvider).register("users", {
        settings: { mfa: { totp: "optional" } } as never,
      });
      const { user, context } = await account(alepha, options);
      const controller = alepha.inject(MyMfaController);
      const totp = alepha.inject(TotpService);
      const enrolment = await controller.enrollTotp({}, context);
      const code = totp.codeForCounter(enrolment.secret, totp.currentStep());
      return { alepha, user, context, controller, code };
    };

    it("asks an account with a password for it before the factor is active", async ({
      expect,
    }) => {
      const { alepha, user, context, controller, code } = await pending({});

      await expect(
        controller.activateTotp({ body: { code } }, context),
      ).rejects.toThrow();
      await expect(
        controller.activateTotp(
          { body: { code, proof: { currentPassword: "not-the-password" } } },
          context,
        ),
      ).rejects.toThrow();
      expect(
        (await alepha.inject(MfaService).statusFor(user.id)).totp.enabled,
      ).toBe(false);

      const activated = await controller.activateTotp(
        { body: { code, proof: { currentPassword: PASSWORD } } },
        context,
      );
      expect(activated.recoveryCodes).toHaveLength(10);
    });

    it("asks nothing of an account that holds no proof", async ({ expect }) => {
      const { context, controller, code } = await pending({
        password: false,
        oauth: true,
      });

      const activated = await controller.activateTotp(
        { body: { code } },
        context,
      );

      expect(activated.recoveryCodes).toHaveLength(10);
    });
  });

  describe("current-password checks spend the account's budget", () => {
    const bootLimited = async () => {
      const alepha = await boot();
      alepha.inject(RealmProvider).register("users", {
        settings: {
          username: "optional",
          mfa: { totp: "optional" },
          loginRateLimit: { accountMaxAttempts: 3 },
        } as never,
      });
      return alepha;
    };

    it("locks the password change after the budget is spent", async ({
      expect,
    }) => {
      const alepha = await bootLimited();
      const { email, context } = await account(alepha);
      const controller = alepha.inject(MyPasswordController);
      const change = (currentPassword: string) =>
        controller.changeMyPassword(
          { body: { currentPassword, newPassword: OTHER_PASSWORD } },
          context,
        );

      for (let i = 0; i < 3; i++) {
        await expect(change(`guess-${i}`)).rejects.toThrow(
          "Current password is incorrect",
        );
      }

      // The right password is now refused too, here and at the login.
      await expect(change(PASSWORD)).rejects.toThrow(
        "Current password is incorrect",
      );
      await expect(
        alepha.inject(SessionService).login("credentials", email, PASSWORD),
      ).rejects.toThrow();
    });

    it("gives the slot back on a right password", async ({ expect }) => {
      const alepha = await bootLimited();
      const { context } = await account(alepha);
      const controller = alepha.inject(MyPasswordController);

      await expect(
        controller.changeMyPassword(
          { body: { currentPassword: "guess", newPassword: OTHER_PASSWORD } },
          context,
        ),
      ).rejects.toThrow();
      for (let i = 0; i < 4; i++) {
        const next = i % 2 === 0 ? OTHER_PASSWORD : PASSWORD;
        const current = i % 2 === 0 ? PASSWORD : OTHER_PASSWORD;
        const done = await controller.changeMyPassword(
          { body: { currentPassword: current, newPassword: next } },
          context,
        );
        expect(done.otherSessionsRevoked).toBe(0);
      }
    });

    it("locks the account deletion after the budget is spent", async ({
      expect,
    }) => {
      const alepha = await bootLimited();
      const { user, email, context } = await account(alepha);
      const controller = alepha.inject(MyAccountController);
      const remove = (currentPassword: string) =>
        controller.deleteMyAccount(
          { body: { confirm: email, currentPassword } },
          context,
        );

      for (let i = 0; i < 3; i++) {
        await expect(remove(`guess-${i}`)).rejects.toThrow();
      }
      await expect(remove(PASSWORD)).rejects.toThrow();

      expect(
        await alepha.inject(RealmProvider).userRepository().findById(user.id),
      ).toBeDefined();
    });

    it("locks the password proof after the budget is spent", async ({
      expect,
    }) => {
      const alepha = await bootLimited();
      const { user, context } = await account(alepha);
      const controller = alepha.inject(MyMfaController);
      const totp = alepha.inject(TotpService);
      const enrolment = await controller.enrollTotp({}, context);
      const activate = (currentPassword: string) =>
        controller.activateTotp(
          {
            body: {
              code: totp.codeForCounter(enrolment.secret, totp.currentStep()),
              proof: { currentPassword },
            },
          },
          context,
        );

      for (let i = 0; i < 3; i++) {
        await expect(activate(`guess-${i}`)).rejects.toThrow();
      }
      await expect(activate(PASSWORD)).rejects.toThrow();
      expect(
        (await alepha.inject(MfaService).statusFor(user.id)).totp.enabled,
      ).toBe(false);
    });
  });

  describe("an admin password reset", () => {
    it("signs the account out everywhere", async ({ expect }) => {
      const alepha = await boot();
      const { user } = await account(alepha);
      await alepha.inject(SessionService).createSession(user as never, 3600);
      expect(await sessionsOf(alepha, user.id)).toHaveLength(2);

      await alepha.inject(AdminUserController).setUserPassword(
        {
          params: { id: user.id },
          query: {},
          body: { password: OTHER_PASSWORD },
        },
        {
          user: {
            id: "00000000-0000-0000-0000-0000000000a1",
            roles: ["admin"],
            realm: "users",
          },
        } as never,
      );

      expect(await sessionsOf(alepha, user.id)).toHaveLength(0);
    });
  });

  describe("second-factor codes are spent once", () => {
    const enrolled = async () => {
      const alepha = await boot();
      alepha.inject(RealmProvider).register("users", {
        settings: {
          mfa: { totp: "optional" },
          loginRateLimit: { accountMaxAttempts: 50 },
        } as never,
      });
      const { user } = await account(alepha, { password: false });
      const mfa = alepha.inject(MfaService);
      const totp = alepha.inject(TotpService);
      const enrolment = await mfa.beginTotpEnrollment(user.id);
      const { recoveryCodes } = await mfa.activateTotp(
        user.id,
        totp.codeForCounter(enrolment.secret, totp.currentStep()),
      );
      return { user, mfa, totp, secret: enrolment.secret, recoveryCodes };
    };

    it("accepts one of five concurrent uses of a recovery code", async ({
      expect,
    }) => {
      const { user, mfa, recoveryCodes } = await enrolled();

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          mfa.verify(user.id, "totp", recoveryCodes[0]),
        ),
      );

      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await mfa.statusFor(user.id)).totp.recoveryCodesLeft).toBe(9);
    });

    it("accepts one of five concurrent uses of a TOTP code", async ({
      expect,
    }) => {
      const { user, mfa, totp, secret } = await enrolled();
      const code = totp.codeForCounter(secret, totp.currentStep() + 1);

      const results = await Promise.all(
        Array.from({ length: 5 }, () => mfa.verify(user.id, "totp", code)),
      );

      expect(results.filter(Boolean)).toHaveLength(1);
    });
  });
});
