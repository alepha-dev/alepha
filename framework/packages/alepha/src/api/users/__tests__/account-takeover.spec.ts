import { Alepha } from "alepha";
import { AuditService } from "alepha/api/audits";
import { AlephaApiVerification } from "alepha/api/verifications";
import { AlephaEmail } from "alepha/email";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { AlephaSecurity, CryptoProvider } from "alepha/security";
import { TooManyRequestsError } from "alepha/server";
import { describe, expect, it } from "vitest";

import {
  $realm,
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
  UserNotifications,
  UsernameSlugger,
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
 * A container whose realm can verify addresses: it needs the mail and
 * verification modules a verification code goes through.
 */
const bootVerifying = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(AlephaOrmTestPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiVerification);
  alepha.with(AlephaApiUsers);
  alepha.with(UserNotifications);
  await alepha.start();
  return alepha;
};

/**
 * Register `users` as a realm that verifies addresses.
 */
const verifyingRealm = (
  alepha: Alepha,
  settings: Record<string, unknown> = {},
) =>
  alepha.inject(RealmProvider).register("users", {
    features: { notifications: true },
    settings: { verifyEmailRequired: true, ...settings },
  });

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

  /**
   * Pinned: a verified provider sign-in onto an account whose address is
   * unverified is linked to it, and the account keeps everything it had, in
   * a realm that verifies addresses as in one that does not. A change of
   * this behavior has to be deliberate.
   */
  describe("provider sign-in onto an unverified account", () => {
    it.each([
      ["verifies addresses", true],
      ["does not verify addresses", false],
    ])(
      "links and removes nothing, in a realm that %s",
      async (_label, verifies) => {
        const alepha = verifies ? await bootVerifying() : await boot();
        if (verifies) {
          verifyingRealm(alepha);
        }
        const email = `member-${tag()}@example.com`;
        const { user: member } = await account(alepha, { email });
        expect(member.emailVerified).toBe(false);

        const linked = await alepha.inject(SessionService).link("google", {
          sub: `g-${tag()}`,
          email,
          email_verified: true,
        });

        expect(linked.id).toBe(member.id);
        expect(linked.emailVerified).toBe(false);
        const again = await alepha
          .inject(SessionService)
          .login("credentials", email, PASSWORD);
        expect(again.id).toBe(member.id);
        expect(await sessionsOf(alepha, member.id)).toHaveLength(1);
        const identities = await alepha
          .inject(RealmProvider)
          .identityRepository()
          .findMany({ where: { userId: { eq: member.id } } });
        expect(identities.map((it) => it.provider).sort()).toEqual([
          "credentials",
          "google",
        ]);
      },
    );
  });

  describe("adminEmails in a realm that verifies addresses", () => {
    it("does not promote a password account whose address is unverified", async ({
      expect,
    }) => {
      const alepha = await bootVerifying();
      const email = `boss-${tag()}@example.com`;
      verifyingRealm(alepha, { adminEmails: [email] });
      const sessions = alepha.inject(SessionService);
      const { user } = await account(alepha, { email });

      const loggedIn = await sessions.login("credentials", email, PASSWORD);
      expect(loggedIn.roles).not.toContain("admin");

      // Once the address is verified, the same sign-in promotes.
      await alepha
        .inject(RealmProvider)
        .userRepository()
        .updateById(user.id, { emailVerified: true });
      const verified = await sessions.login("credentials", email, PASSWORD);
      expect(verified.roles).toContain("admin");
    });

    it("does not let an unverified provider address through a closed realm", async ({
      expect,
    }) => {
      const alepha = await bootVerifying();
      const realmProvider = alepha.inject(RealmProvider);
      const email = `ceo-${tag()}@example.com`;
      verifyingRealm(alepha, {
        registrationAllowed: false,
        adminEmails: [email],
      });
      const sessions = alepha.inject(SessionService);

      await expect(
        sessions.link("github", {
          sub: `gh-${tag()}`,
          email,
          email_verified: false,
        }),
      ).rejects.toThrow("Account doesn't exist");
      expect(
        await realmProvider
          .userRepository()
          .findOne({ where: { realm: "users", email } }),
      ).toBeUndefined();

      // The provider vouching for the address is what opens the door.
      const admin = await sessions.link("github", {
        sub: `gh-${tag()}`,
        email,
        email_verified: true,
      });
      expect(admin.roles).toContain("admin");
    });

    it("does not promote an unverified provider address on an open realm", async ({
      expect,
    }) => {
      const alepha = await bootVerifying();
      const email = `cto-${tag()}@example.com`;
      verifyingRealm(alepha, { adminEmails: [email] });

      const user = await alepha
        .inject(SessionService)
        .link("github", { sub: `gh-${tag()}`, email, email_verified: false });

      expect(user.emailVerified).toBe(false);
      expect(user.roles).not.toContain("admin");
    });
  });

  describe("adminEmails in a realm that does not verify addresses", () => {
    it("promotes the address at its first sign-in, verified or not", async ({
      expect,
    }) => {
      const alepha = await boot();
      const email = `boss-${tag()}@example.com`;
      alepha
        .inject(RealmProvider)
        .register("users", { settings: { adminEmails: [email] } });
      const registration = alepha.inject(RegistrationService);

      const intent = await registration.createRegistrationIntent({
        email,
        password: PASSWORD,
      });
      const user = await registration.completeRegistration({
        intentId: intent.intentId,
      });
      expect(user.emailVerified).toBe(false);

      const loggedIn = await alepha
        .inject(SessionService)
        .login("credentials", email, PASSWORD);
      expect(loggedIn.roles).toContain("admin");
    });

    it("lets an unverified provider address through a closed realm", async ({
      expect,
    }) => {
      const alepha = await boot();
      const email = `ceo-${tag()}@example.com`;
      alepha.inject(RealmProvider).register("users", {
        settings: { registrationAllowed: false, adminEmails: [email] },
      });

      const admin = await alepha
        .inject(SessionService)
        .link("github", { sub: `gh-${tag()}`, email, email_verified: false });

      expect(admin.roles).toContain("admin");

      // Any other address still meets the closed door.
      await expect(
        alepha.inject(SessionService).link("github", {
          sub: `gh-${tag()}`,
          email: `other-${tag()}@example.com`,
          email_verified: true,
        }),
      ).rejects.toThrow("Account doesn't exist");
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

    it("still promotes the account that registers an admin username", async ({
      expect,
    }) => {
      const alepha = await boot();
      const boss = `boss${tag()}`;
      alepha.inject(RealmProvider).register("users", {
        settings: { username: "required", adminUsernames: [boss] },
      });
      const registration = alepha.inject(RegistrationService);

      const intent = await registration.createRegistrationIntent({
        username: boss,
        email: `x-${tag()}@example.com`,
        password: PASSWORD,
      });
      await registration.completeRegistration({ intentId: intent.intentId });

      const loggedIn = await alepha
        .inject(SessionService)
        .login("credentials", boss, PASSWORD);
      expect(loggedIn.roles).toContain("admin");
    });

    it("promotes the admin username registered in another case, and no other name", async ({
      expect,
    }) => {
      const alepha = await boot();
      const t = tag();
      alepha.inject(RealmProvider).register("users", {
        settings: { username: "required", adminUsernames: [`bossfree${t}`] },
      });
      const registration = alepha.inject(RegistrationService);
      const register = async (username: string) => {
        const intent = await registration.createRegistrationIntent({
          username,
          email: `${username}@example.com`,
          password: PASSWORD,
        });
        await registration.completeRegistration({ intentId: intent.intentId });
        return alepha
          .inject(SessionService)
          .login("credentials", username, PASSWORD);
      };

      expect((await register(`BossFree${t}`)).roles).toContain("admin");
      expect((await register(`bossfre${t}`)).roles).toEqual(["user"]);
    });

    it("does not tell an anonymous caller which names are admin names", async ({
      expect,
    }) => {
      const alepha = await boot();
      const boss = `boss${tag()}`;
      alepha.inject(RealmProvider).register("users", {
        settings: {
          username: "required",
          adminUsernames: [boss],
          usernameBlocklist: ["root"],
        },
      });
      const slugger = alepha.inject(UsernameSlugger);

      // What `/realms/check-username` answers from: a free admin name reads
      // as any free name, a blocklisted one as unavailable.
      expect(await slugger.isBlocked("users", boss)).toBe(false);
      expect(await slugger.isBlocked("users", `plain${tag()}`)).toBe(false);
      expect(await slugger.isBlocked("users", "root")).toBe(true);
    });

    it("does not derive a reserved admin username from an email", async ({
      expect,
    }) => {
      const alepha = await boot();
      const boss = `boss${tag()}`;
      alepha.inject(RealmProvider).register("users", {
        settings: { username: "email", adminUsernames: [boss] },
      });
      const registration = alepha.inject(RegistrationService);

      const intent = await registration.createRegistrationIntent({
        email: `${boss}@example.com`,
        password: PASSWORD,
      });
      const user = await registration.completeRegistration({
        intentId: intent.intentId,
      });

      expect(user.username).not.toBe(boss);
      const loggedIn = await alepha
        .inject(SessionService)
        .login("credentials", `${boss}@example.com`, PASSWORD);
      expect(loggedIn.roles).not.toContain("admin");
    });

    it("lets the holder of an admin username keep it on a profile save", async ({
      expect,
    }) => {
      const alepha = await boot();
      const boss = `boss${tag()}`;
      const realmProvider = alepha.inject(RealmProvider);
      realmProvider.register("users", {
        settings: { username: "optional", adminUsernames: [boss] },
      });
      const { user, context } = await account(alepha);
      // Named by an administrator.
      await realmProvider
        .userRepository()
        .updateById(user.id, { username: boss });

      const profile = await alepha
        .inject(MyProfileController)
        .updateMyProfile(
          { body: { username: boss, firstName: "Ada" } },
          context,
        );

      expect(profile.username).toBe(boss);
      expect(profile.firstName).toBe("Ada");
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

      // The right password is now refused too, and told why: the budget is
      // spent, not the password wrong. The login refuses it as well.
      await expect(change(PASSWORD)).rejects.toThrow(TooManyRequestsError);
      await expect(
        alepha.inject(SessionService).login("credentials", email, PASSWORD),
      ).rejects.toThrow();
    });

    it("audits the failure that spends the budget, as the login does", async ({
      expect,
    }) => {
      // A declared `$realm`: it is what registers the audit types.
      const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
      alepha.with(AlephaOrmTestPostgres);
      alepha.with(AlephaSecurity);
      alepha.with(() => ({
        realm: $realm({
          settings: { loginRateLimit: { accountMaxAttempts: 3 } } as never,
        }),
      }));
      await alepha.start();
      const audits = alepha.inject(AuditService);
      const { user, context } = await account(alepha);
      const controller = alepha.inject(MyPasswordController);
      const rateLimited = async () =>
        (
          await audits.find({
            type: "security",
            action: "rate_limited",
            resourceId: user.id,
          })
        ).content;

      for (let i = 0; i < 2; i++) {
        await expect(
          controller.changeMyPassword(
            { body: { currentPassword: "guess", newPassword: OTHER_PASSWORD } },
            context,
          ),
        ).rejects.toThrow("Current password is incorrect");
      }
      expect(await rateLimited()).toHaveLength(0);

      await expect(
        controller.changeMyPassword(
          { body: { currentPassword: "guess", newPassword: OTHER_PASSWORD } },
          context,
        ),
      ).rejects.toThrow("Current password is incorrect");
      expect(await rateLimited()).toHaveLength(1);

      // Refusals after that write nothing more.
      await expect(
        controller.changeMyPassword(
          { body: { currentPassword: PASSWORD, newPassword: OTHER_PASSWORD } },
          context,
        ),
      ).rejects.toThrow(TooManyRequestsError);
      expect(await rateLimited()).toHaveLength(1);
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
        await expect(remove(`guess-${i}`)).rejects.toThrow(
          "Current password is incorrect",
        );
      }
      await expect(remove(PASSWORD)).rejects.toThrow(TooManyRequestsError);

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
      await expect(activate(PASSWORD)).rejects.toThrow(TooManyRequestsError);
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
