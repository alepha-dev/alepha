import { Alepha } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaApiVerification } from "alepha/api/verifications";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { AlephaSecurity, CryptoProvider } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { AlephaServerEtag } from "alepha/server/etag";
import { describe, it } from "vitest";

import {
  $realm,
  AlephaApiUsers,
  CredentialService,
  MfaService,
  type RealmConfig,
  RealmProvider,
  RegistrationService,
  UserJobs,
  UserNotifications,
} from "../index.ts";

const tag = () => Math.random().toString(36).slice(2, 8);

/**
 * The answer a caller reads: the status and the message, or `ok`.
 */
const answer = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return "ok";
  } catch (error) {
    const { status, message } = error as { status?: number; message?: string };
    return `${status} ${message}`;
  }
};

class TestCredentialService extends CredentialService {
  public testResetIp = this.resetIp;
  public testCompleteIp = this.completeIp;
}

class TestMfaService extends MfaService {
  public testGenerateRecoveryCodes = this.generateRecoveryCodes.bind(this);
  public testRecoveryCodeAlphabet = this.recoveryCodeAlphabet;
}

const boot = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with({ provide: CredentialService, use: TestCredentialService });
  alepha.with({ provide: MfaService, use: TestMfaService });
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
 * Run `fn` as an HTTP request that carries no client address, which is what
 * a runtime with no socket and no `TRUST_PROXY` hands the handlers.
 */
const withoutClientAddress = <T>(alepha: Alepha, fn: () => Promise<T>) =>
  alepha.fork(async () => {
    alepha.store.set("alepha.http.request", { headers: {} } as never);
    return fn();
  });

describe("alepha/api/users - enumeration and limits", () => {
  describe("password reset", () => {
    it("answers the same whether the address has an account or not", async ({
      expect,
    }) => {
      const alepha = await boot();
      alepha.inject(RealmProvider).register("users", {
        features: { notifications: true },
        settings: { resetPasswordAllowed: true },
      });
      const credentials = alepha.inject(CredentialService);
      const email = `known-${tag()}@example.com`;
      const user = await credentials.users().create({ email, roles: ["user"] });
      await credentials.identities().create({
        userId: user.id,
        provider: "credentials",
        password: await alepha
          .inject(CryptoProvider)
          .hashPassword("OldPassword123!"),
      });

      const known = await credentials.createPasswordResetIntent(email);
      const unknown = await credentials.createPasswordResetIntent(
        `unknown-${tag()}@example.com`,
      );
      const complete = (intentId: string, newPassword: string) =>
        answer(
          credentials.completePasswordReset({
            intentId,
            code: "000000",
            newPassword,
          }),
        );

      // A password the policy refuses, then one it accepts with a wrong code.
      const weak = await complete(known.intentId, "aaaaaaaa");
      expect(await complete(unknown.intentId, "aaaaaaaa")).toBe(weak);
      const wrongCode = await complete(known.intentId, "NewPassword456!");
      expect(wrongCode).toBe("400 Invalid or expired verification code");
      expect(await complete(unknown.intentId, "NewPassword456!")).toBe(
        wrongCode,
      );
    });

    it("answers the same for an account that signs in through a provider only", async ({
      expect,
    }) => {
      const alepha = await boot();
      alepha.inject(RealmProvider).register("users", {
        features: { notifications: true },
        settings: { resetPasswordAllowed: true },
      });
      const credentials = alepha.inject(CredentialService);
      const email = `oauth-${tag()}@example.com`;
      await credentials.users().create({ email, roles: ["user"] });

      const intent = await credentials.createPasswordResetIntent(email);

      expect(
        await answer(
          credentials.completePasswordReset({
            intentId: intent.intentId,
            code: "000000",
            newPassword: "NewPassword456!",
          }),
        ),
      ).toBe("400 Invalid or expired verification code");
    });
  });

  describe("a request with no client address", () => {
    it("counts a registration against the shared bucket", async ({
      expect,
    }) => {
      const alepha = await boot();
      alepha.inject(RealmProvider).register("users", {
        settings: { registrationIpMaxAttempts: 2 },
      });
      const registration = alepha.inject(RegistrationService);
      const attempt = () =>
        withoutClientAddress(alepha, () =>
          answer(
            registration.createRegistrationIntent({
              email: `noip-${tag()}@example.com`,
              password: "SecurePassword123!",
            }),
          ),
        );

      expect(await attempt()).toBe("ok");
      expect(await attempt()).toBe("ok");
      expect(await attempt()).toBe(
        "400 Too many registration attempts, please try again later",
      );
    });

    it("counts a password reset request and its completion", async ({
      expect,
    }) => {
      const alepha = await boot();
      alepha.inject(RealmProvider).register("users", {
        features: { notifications: true },
        settings: { resetPasswordAllowed: true },
      });
      const credentials = alepha.inject(TestCredentialService);

      await withoutClientAddress(alepha, async () => {
        await credentials.createPasswordResetIntent(
          `nobody-${tag()}@example.com`,
        );
        await answer(
          credentials.completePasswordReset({
            intentId: globalThis.crypto.randomUUID(),
            code: "000000",
            newPassword: "NewPassword456!",
          }),
        );
      });

      // Each took one slot of the shared bucket: the next is the second.
      expect((await credentials.testResetIp.consume("unknown")).count).toBe(2);
      expect((await credentials.testCompleteIp.consume("unknown")).count).toBe(
        2,
      );
    });
  });

  describe("recovery codes", () => {
    it("carries 80 bits: sixteen symbols of a 32-symbol alphabet", async ({
      expect,
    }) => {
      const alepha = await boot();
      const mfa = alepha.inject(TestMfaService);

      const alphabet = mfa.testRecoveryCodeAlphabet;
      expect(new Set(alphabet).size).toBe(32);

      const codes = mfa.testGenerateRecoveryCodes();
      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
      for (const code of codes) {
        expect(code).toMatch(/^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/);
        expect(code).toBe(code.toLowerCase());
        for (const symbol of code.replaceAll("-", "")) {
          expect(alphabet).toContain(symbol);
        }
      }
    });

    it("still accepts a code issued in the earlier format", async ({
      expect,
    }) => {
      const alepha = await boot();
      const realmProvider = alepha.inject(RealmProvider);
      realmProvider.register("users", {
        settings: { mfa: { totp: "optional" } } as never,
      });
      const crypto = alepha.inject(CryptoProvider);
      const mfa = alepha.inject(MfaService);
      const user = await realmProvider
        .userRepository()
        .create({ email: `old-${tag()}@example.com` });
      const enrolment = await mfa.beginTotpEnrollment(user.id);
      const identity = await realmProvider.identityRepository().getOne({
        where: { userId: { eq: user.id }, provider: { eq: "totp" } },
      });
      expect(enrolment.secret).toBeTruthy();
      await realmProvider.identityRepository().updateById(identity.id, {
        providerData: {
          ...(identity.providerData as object),
          status: "active",
          recoveryCodes: [await crypto.hash("tyw8u-x5kp9")],
        },
      });

      expect(await mfa.verify(user.id, "totp", "TYW8U-X5KP9")).toBe(true);
      expect(await mfa.verify(user.id, "totp", "tyw8u-x5kp9")).toBe(false);
    });
  });

  describe("public realm config", () => {
    it("publishes what a sign-in page reads and nothing else", async ({
      expect,
    }) => {
      const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
        .with(AlephaServer)
        .with(AlephaServerEtag)
        .with(AlephaOrmTestPostgres)
        .with(AlephaSecurity)
        .with(() => ({
          realm: $realm({
            settings: {
              adminEmails: ["boss@example.com"],
              usernameBlocklist: ["root"],
              refreshToken: { expirationIdle: 60_000 },
            },
          }),
        }));
      await alepha.start();
      const { hostname } = alepha.inject(ServerProvider);

      const response = await fetch(`${hostname}/api/realms/config`);
      const config = (await response.json()) as RealmConfig;
      await alepha.stop();

      expect(Object.keys(config.settings).sort()).toEqual([
        "captchaRequired",
        "email",
        "firstNameLastName",
        "mfa",
        "passkeys",
        "passwordPolicy",
        "phoneNumber",
        "registrationAllowed",
        "resetPasswordAllowed",
        "username",
        "usernameRegExp",
        "verifyEmailRequired",
        "verifyPhoneRequired",
      ]);
    });
  });

  describe("idle session sweep", () => {
    const bootJobs = async (
      register: (realmProvider: RealmProvider) => void,
    ) => {
      const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
        .with(AlephaOrmTestPostgres)
        .with(AlephaApiJobs)
        .with(AlephaSecurity)
        .with(AlephaApiUsers);
      const jobs = alepha.inject(UserJobs);
      const realmProvider = alepha.inject(RealmProvider);
      register(realmProvider);
      await alepha.start();
      const dateTime = alepha.inject(DateTimeProvider);
      const idleSession = async (realm: string) => {
        const user = await realmProvider
          .userRepository(realm)
          .create({ realm, email: `${realm}-${tag()}@example.com` });
        const session = await realmProvider.sessionRepository(realm).create({
          userId: user.id,
          refreshToken: globalThis.crypto.randomUUID(),
          expiresAt: dateTime.now().add(30, "days").toISOString(),
          lastUsedAt: dateTime.now().subtract(30, "minutes").toISOString(),
        });
        return session.id;
      };
      const exists = async (realm: string, id: string) =>
        !!(await realmProvider.sessionRepository(realm).findById(id));
      return { jobs, idleSession, exists };
    };

    it("applies each realm's own idle timeout to its own sessions", async ({
      expect,
    }) => {
      const { jobs, idleSession, exists } = await bootJobs((realmProvider) => {
        realmProvider.register("strict", {
          issuer: { default: true } as never,
          settings: { refreshToken: { expirationIdle: 5 * 60_000 } },
        });
        realmProvider.register("relaxed");
      });
      const strict = await idleSession("strict");
      const relaxed = await idleSession("relaxed");

      await jobs.purgeExpiredSessions.trigger();

      expect(await exists("strict", strict)).toBe(false);
      expect(await exists("relaxed", relaxed)).toBe(true);
    });

    it("sweeps several realms when none is the default", async ({ expect }) => {
      const { jobs, idleSession, exists } = await bootJobs((realmProvider) => {
        realmProvider.register("one", {
          settings: { refreshToken: { expirationIdle: 5 * 60_000 } },
        });
        realmProvider.register("two");
      });
      const one = await idleSession("one");
      const two = await idleSession("two");

      await jobs.purgeExpiredSessions.trigger();

      expect(await exists("one", one)).toBe(false);
      expect(await exists("two", two)).toBe(true);
    });
  });
});
