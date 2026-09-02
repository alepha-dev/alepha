import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import {
  AlephaSecurity,
  JwtProvider,
  SecurityProvider,
  type UserAccountToken,
} from "alepha/security";
import { UnauthorizedError } from "alepha/server";
import { describe, expect, it } from "vitest";

import {
  $realm,
  AdminUserController,
  AlephaApiUsers,
  RealmProvider,
  SessionService,
  UserService,
} from "../index.ts";

/**
 * The users, sessions and identities tables are shared between realms. A
 * realm admin used to reach any account by id, and a refresh token minted by
 * one realm was accepted by another realm's issuer, which then signed an
 * access token carrying the foreign roles.
 *
 * The ACCESS token had the same hole and kept it longer, because it is not a
 * lookup: every realm signs with the same key by default, so B's signature
 * verifies under A, the resolvers run in priority order, and the first one to
 * verify claims the request - resolving the caller as A and substituting A's
 * roles for their own.
 */
const suffix = () => Math.random().toString(36).slice(2, 8);

describe("realm isolation", () => {
  describe("admin lookups", () => {
    const boot = async () => {
      const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
      alepha.with(AlephaOrmPostgres);
      alepha.with(AlephaSecurity);
      alepha.with(AlephaApiUsers);
      await alepha.start();
      const realmProvider = alepha.inject(RealmProvider);
      realmProvider.register("tenant-a");
      realmProvider.register("tenant-b");
      return alepha;
    };

    it("does not let a realm admin reach another realm's user by id", async () => {
      const alepha = await boot();
      const tag = suffix();
      const userService = alepha.inject(UserService);
      const controller = alepha.inject(AdminUserController);

      const victim = await userService.createUser(
        { email: `victim-${tag}@example.com`, username: `victim${tag}` },
        "tenant-b",
      );

      const adminA: UserAccountToken = {
        id: "00000000-0000-0000-0000-0000000000a1",
        roles: ["admin"],
        realm: "tenant-a",
      };
      const asAdminA = { user: adminA };

      await expect(
        controller.getUser(
          { params: { id: victim.id }, query: { userRealmName: "tenant-a" } },
          asAdminA,
        ),
      ).rejects.toThrow();

      const page = await controller.findUsers(
        { query: { userRealmName: "tenant-a", email: victim.email } } as never,
        asAdminA,
      );
      expect(page.content.map((u) => u.id)).not.toContain(victim.id);

      await expect(
        controller.setUserPassword(
          {
            params: { id: victim.id },
            query: { userRealmName: "tenant-a" },
            body: { password: "Hijacked123!" },
          },
          asAdminA,
        ),
      ).rejects.toThrow();

      // The same admin still reaches the account in its own realm.
      const read = await controller.getUser(
        { params: { id: victim.id }, query: { userRealmName: "tenant-b" } },
        { user: { ...adminA, realm: "tenant-b" } },
      );
      expect(read.id).toBe(victim.id);
    });
  });

  /**
   * Same question one level up, and the one the tenant check's own comment
   * already answered for tenants: "a token minted on tenant A must not
   * authenticate on tenant B". Realms had no equivalent.
   */
  describe("access tokens", () => {
    class Realms {
      // Declared first, so a realm-less lookup falls back to this one and a
      // token wrongly claimed here resolves with `citizens` roles.
      citizens = $realm({ issuer: { name: "citizens" }, identities: {} });
      staff = $realm({ issuer: { name: "staff" }, identities: {} });
    }

    const boot = async () => {
      const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
      alepha.with(AlephaOrmPostgres);
      alepha.with(AlephaSecurity);
      alepha.with(Realms);
      await alepha.start();
      return { alepha, realms: alepha.inject(Realms) };
    };

    const resolve = async (alepha: Alepha, accessToken: string) =>
      alepha.inject(SecurityProvider).resolveUserFromServerRequest({
        url: new URL("https://app.example/api"),
        headers: { authorization: `Bearer ${accessToken}` },
      } as never);

    /**
     * `createToken` writes a session row, so the account has to exist.
     */
    const account = async (alepha: Alepha, realm: string, roles: string[]) => {
      const tag = suffix();
      return alepha.inject(UserService).createUser(
        {
          email: `${realm}-${tag}@example.com`,
          username: `${realm}${tag}`,
          roles,
        },
        realm,
      );
    };

    it("refuses an access token minted by another realm", async () => {
      const { alepha, realms } = await boot();
      const user = await account(alepha, "staff", ["admin"]);

      const { access_token } = await realms.staff.createToken(user as never);

      // Before the audience check this resolved, and resolved as `citizens`:
      // the caller's own roles were dropped and the first realm's substituted.
      // It failed CLOSED in that direction only because the wrong realm
      // granted less, which is an accident of declaration order.
      const resolved = await resolve(alepha, access_token);

      expect(resolved?.realm).not.toBe("citizens");
      expect(resolved?.realm ?? "staff").toBe("staff");
    });

    it("still accepts a token in the realm that minted it", async () => {
      const { alepha, realms } = await boot();

      const staffUser = await account(alepha, "staff", ["admin"]);
      const citizenUser = await account(alepha, "citizens", ["user"]);

      const staff = await realms.staff.createToken(staffUser as never);
      const citizens = await realms.citizens.createToken(citizenUser as never);

      const asStaff = await resolve(alepha, staff.access_token);
      expect(asStaff?.realm).toBe("staff");
      // The caller's OWN roles, not the first realm's: substituting them is
      // the other half of what the cross-realm acceptance did.
      expect(asStaff?.roles).toContain("admin");

      const asCitizen = await resolve(alepha, citizens.access_token);
      expect(asCitizen?.realm).toBe("citizens");
      expect(asCitizen?.roles).not.toContain("admin");
    });

    it("refuses a hand-minted token that names no realm at all", async () => {
      const { alepha } = await boot();
      const user = await account(alepha, "staff", ["admin"]);
      const jwt = alepha.inject(JwtProvider);

      // `JwtProvider.create` is public API, and its `keyName` argument selects
      // a signing KEY - which every realm shares by default, so it identifies
      // nothing. Such a token used to be claimed by whichever resolver ran
      // first. With more than one realm it is refused instead; with one realm
      // it is still accepted, since there is nothing to be ambiguous about.
      const token = await jwt.create(
        { sub: user.id, roles: ["admin"] },
        "staff",
        {
          header: { typ: jwt.accessTokenTyp },
        },
      );

      expect(await resolve(alepha, token)).toBeUndefined();
    });
  });

  describe("refresh tokens", () => {
    class Realms {
      a = $realm({ issuer: { name: "tenant-a" }, identities: {} });
      b = $realm({ issuer: { name: "tenant-b" }, identities: {} });
    }

    it("refuses a refresh token minted by another realm", async () => {
      const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
      alepha.with(AlephaOrmPostgres);
      alepha.with(AlephaSecurity);
      alepha.with(Realms);
      await alepha.start();

      const tag = suffix();
      const realms = alepha.inject(Realms);
      const userService = alepha.inject(UserService);
      const sessionService = alepha.inject(SessionService);

      const userB = await userService.createUser(
        {
          email: `b-${tag}@example.com`,
          username: `b${tag}`,
          roles: ["admin"],
        },
        "tenant-b",
      );
      const { refreshToken } = await sessionService.createSession(
        userB as never,
        3600,
        "tenant-b",
      );

      await expect(realms.a.refreshToken(refreshToken)).rejects.toThrow(
        UnauthorizedError,
      );

      // The realm that minted it still honours it.
      const result = await realms.b.refreshToken(refreshToken);
      expect(result.user.realm).toBe("tenant-b");
    });

    it("answers 401, not 404, for an unknown refresh token", async () => {
      const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
      alepha.with(AlephaOrmPostgres);
      alepha.with(AlephaSecurity);
      alepha.with(Realms);
      await alepha.start();

      const sessionService = alepha.inject(SessionService);
      await expect(
        sessionService.refreshSession(crypto.randomUUID(), "tenant-a"),
      ).rejects.toThrow(UnauthorizedError);
    });
  });
});
