import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
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
