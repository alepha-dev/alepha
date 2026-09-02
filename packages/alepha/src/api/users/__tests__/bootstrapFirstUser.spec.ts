import { Alepha } from "alepha";
import { AlephaApiVerification } from "alepha/api/verifications";
import { AlephaEmail } from "alepha/email";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { describe, it } from "vitest";

import {
  AlephaApiUsers,
  RealmProvider,
  RegistrationService,
  SessionService,
} from "../index.ts";

const setup = async () => {
  const alepha = Alepha.create();

  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiVerification);
  alepha.with(AlephaApiUsers);

  await alepha.start();

  return {
    alepha,
    realmProvider: alepha.inject(RealmProvider),
    registrationService: alepha.inject(RegistrationService),
    sessionService: alepha.inject(SessionService),
  };
};

/**
 * Register through both phases, which is what actually creates the row.
 * The realms here never set `verifyEmailRequired`, so no code is involved.
 */
const register = async (
  registrationService: RegistrationService,
  email: string,
  realm: string,
) => {
  const intent = await registrationService.createRegistrationIntent(
    { email, password: "SecurePassword123!" },
    realm,
  );
  // The realm travels on the intent, so completion takes no realm argument.
  return registrationService.completeRegistration({
    intentId: intent.intentId,
  });
};

/**
 * Count `findOne` calls on a repository, to assert what a realm does NOT
 * cost. A plain wrapper rather than `vi.spyOn`, which this repo does not use.
 */
const countFindOne = (repository: object): (() => number) => {
  const target = repository as { findOne: (...args: unknown[]) => unknown };
  const original = target.findOne.bind(target);
  let reads = 0;
  target.findOne = (...args: unknown[]) => {
    reads++;
    return original(...args);
  };
  return () => reads;
};

describe("alepha/api/users - bootstrapFirstUser", () => {
  describe("the admin grant", () => {
    it("should make the first credentials account an admin", async ({
      expect,
    }) => {
      const { registrationService, realmProvider } = await setup();
      realmProvider.register("bootstrap-credentials", {
        bootstrapFirstUser: true,
      });

      const user = await register(
        registrationService,
        "owner@example.com",
        "bootstrap-credentials",
      );

      expect(user.roles).toContain("admin");
    });

    it("should make the first OAuth account an admin", async ({ expect }) => {
      const { sessionService, realmProvider } = await setup();
      realmProvider.register("bootstrap-oauth", { bootstrapFirstUser: true });

      const user = await sessionService.link(
        "google",
        {
          sub: "google-owner",
          email: "owner@example.com",
          email_verified: true,
        },
        "bootstrap-oauth",
      );

      expect(user.roles).toContain("admin");
    });

    it("should NOT make the second account an admin", async ({ expect }) => {
      const { registrationService, realmProvider } = await setup();
      realmProvider.register("bootstrap-second", { bootstrapFirstUser: true });

      const first = await register(
        registrationService,
        "owner@example.com",
        "bootstrap-second",
      );
      const second = await register(
        registrationService,
        "stranger@example.com",
        "bootstrap-second",
      );

      expect(first.roles).toContain("admin");
      expect(second.roles).not.toContain("admin");
    });

    it("should change nothing when the option is absent", async ({
      expect,
    }) => {
      const { registrationService, realmProvider } = await setup();
      realmProvider.register("no-bootstrap", {});

      const user = await register(
        registrationService,
        "owner@example.com",
        "no-bootstrap",
      );

      expect(user.roles).not.toContain("admin");
    });

    /**
     * The race the rule exists for: two concurrent registrations against an
     * empty table both observe zero before their inserts. Promoting on "it
     * was empty when I looked" makes two admins; promoting on a re-count of
     * one makes none, which is worse. Only the oldest-row rule makes both
     * racers agree on the same winner.
     */
    it("should promote exactly one of two racing accounts", async ({
      expect,
    }) => {
      const { realmProvider } = await setup();
      const realm = realmProvider.register("bootstrap-race", {
        bootstrapFirstUser: true,
      });

      const [a, b] = await Promise.all([
        realm.repositories.users.create({
          realm: "bootstrap-race",
          email: "a@example.com",
          roles: [],
        }),
        realm.repositories.users.create({
          realm: "bootstrap-race",
          email: "b@example.com",
          roles: [],
        }),
      ]);

      const promoted = await Promise.all([
        realmProvider.promoteFirstUserToAdmin(a, "bootstrap-race"),
        realmProvider.promoteFirstUserToAdmin(b, "bootstrap-race"),
      ]);

      expect(promoted.filter(Boolean)).toHaveLength(1);

      const rows = await realm.repositories.users.findMany({
        where: { realm: "bootstrap-race" },
      });
      expect(rows.filter((it) => it.roles.includes("admin"))).toHaveLength(1);
    });
  });

  describe("the lockout guard", () => {
    it("should let the first account register into a CLOSED realm", async ({
      expect,
    }) => {
      const { registrationService, realmProvider } = await setup();
      realmProvider.register("closed-bootstrap", {
        settings: { registrationAllowed: false } as never,
        bootstrapFirstUser: true,
      });

      // An operator who set REGISTRATION_ALLOWED=false on a fresh volume
      // would otherwise brick the instance: no admin exists to reopen it.
      const user = await register(
        registrationService,
        "owner@example.com",
        "closed-bootstrap",
      );

      expect(user.roles).toContain("admin");
    });

    it("should refuse the second account on a CLOSED realm", async ({
      expect,
    }) => {
      const { registrationService, realmProvider } = await setup();
      realmProvider.register("closed-bootstrap-second", {
        settings: { registrationAllowed: false } as never,
        bootstrapFirstUser: true,
      });

      await register(
        registrationService,
        "owner@example.com",
        "closed-bootstrap-second",
      );

      await expect(
        registrationService.createRegistrationIntent(
          { email: "stranger@example.com", password: "SecurePassword123!" },
          "closed-bootstrap-second",
        ),
      ).rejects.toThrowError("Registration is not allowed");
    });

    it("should still refuse a closed realm that did not ask for the option", async ({
      expect,
    }) => {
      const { registrationService, realmProvider } = await setup();
      realmProvider.register("closed-no-bootstrap", {
        settings: { registrationAllowed: false } as never,
      });

      await expect(
        registrationService.createRegistrationIntent(
          { email: "owner@example.com", password: "SecurePassword123!" },
          "closed-no-bootstrap",
        ),
      ).rejects.toThrowError("Registration is not allowed");
    });

    it("should let the first OAuth account into a CLOSED realm", async ({
      expect,
    }) => {
      const { sessionService, realmProvider } = await setup();
      realmProvider.register("closed-oauth-bootstrap", {
        settings: { registrationAllowed: false } as never,
        bootstrapFirstUser: true,
      });

      const user = await sessionService.link(
        "google",
        {
          sub: "google-owner",
          email: "owner@example.com",
          email_verified: true,
        },
        "closed-oauth-bootstrap",
      );

      expect(user.roles).toContain("admin");

      await expect(
        sessionService.link(
          "google",
          {
            sub: "google-stranger",
            email: "stranger@example.com",
            email_verified: true,
          },
          "closed-oauth-bootstrap",
        ),
      ).rejects.toThrowError("Account doesn't exist");
    });
  });

  describe("cost and serverless", () => {
    it("should issue no query at all when the option is absent", async ({
      expect,
    }) => {
      const { realmProvider } = await setup();
      const realm = realmProvider.register("no-bootstrap-cost", {});

      const reads = countFindOne(realm.repositories.users);

      expect(await realmProvider.isAwaitingFirstUser("no-bootstrap-cost")).toBe(
        false,
      );
      expect(reads()).toBe(0);
    });

    it("should look once and then never again", async ({ expect }) => {
      const { realmProvider } = await setup();
      const realm = realmProvider.register("bootstrap-cached", {
        bootstrapFirstUser: true,
      });

      await realm.repositories.users.create({
        realm: "bootstrap-cached",
        email: "owner@example.com",
        roles: [],
      });

      const reads = countFindOne(realm.repositories.users);

      expect(await realmProvider.isAwaitingFirstUser("bootstrap-cached")).toBe(
        false,
      );
      expect(await realmProvider.isAwaitingFirstUser("bootstrap-cached")).toBe(
        false,
      );
      expect(await realmProvider.isAwaitingFirstUser("bootstrap-cached")).toBe(
        false,
      );

      // A table holding a user can never go back to empty in a way that
      // should reopen anything.
      expect(reads()).toBe(1);
    });

    it("should refuse the option on serverless rather than ignore it", async ({
      expect,
    }) => {
      const alepha = Alepha.create({ env: { ALEPHA_SERVERLESS: "true" } });
      alepha.with(AlephaOrmPostgres);
      alepha.with(AlephaSecurity);
      alepha.with(AlephaApiUsers);
      await alepha.start();

      // A freshly deployed Worker with an empty table would otherwise hand
      // admin to whoever registered first, on every isolate.
      expect(() =>
        alepha
          .inject(RealmProvider)
          .register("serverless-bootstrap", { bootstrapFirstUser: true }),
      ).toThrowError(/bootstrapFirstUser/);
    });
  });
});
