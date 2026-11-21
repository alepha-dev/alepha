import { Alepha } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { ForbiddenError, NotFoundError } from "alepha/server";
import { FileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import {
  $realm,
  AdminAvatarController,
  AlephaApiUsers,
  IdentityService,
  identityResourceSchema,
  MfaService,
  MyAvatarController,
  RealmProvider,
  RegistrationService,
  SessionCrudService,
  SessionService,
  TotpService,
  UserController,
  UserService,
  UserStorage,
} from "../index.ts";

const tag = () => Math.random().toString(36).slice(2, 8);

/**
 * Realms share the `users`, `sessions` and `identities` tables: an admin of
 * one realm gets, for a row of another, exactly what a missing id gives.
 */
describe("alepha/api/users - admin API realm scope", () => {
  const boot = async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(AlephaOrmTestPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaApiUsers);
    await alepha.start();
    const realmProvider = alepha.inject(RealmProvider);
    realmProvider.register("tenant-a");
    realmProvider.register("tenant-b", {
      settings: { mfa: { totp: "optional" } } as never,
    });
    return alepha;
  };

  const victimOfB = async (alepha: Alepha) => {
    const t = tag();
    const victim = await alepha
      .inject(UserService)
      .createUser(
        { email: `victim-${t}@example.com`, username: `victim${t}` },
        "tenant-b",
      );
    const { sessionId } = await alepha
      .inject(SessionService)
      .createSession(victim as never, 3600, "tenant-b");
    return { victim, sessionId };
  };

  describe("sessions", () => {
    it("does not bulk delete a session of another realm", async ({
      expect,
    }) => {
      const alepha = await boot();
      const { victim, sessionId } = await victimOfB(alepha);
      const crud = alepha.inject(SessionCrudService);

      const deleted = await crud.deleteSessions([sessionId], "tenant-a");

      expect(deleted).toEqual([]);
      expect(
        await alepha
          .inject(RealmProvider)
          .sessionRepository("tenant-b")
          .findById(sessionId),
      ).toBeDefined();

      // Its own realm deletes it.
      expect(await crud.deleteSessions([sessionId], "tenant-b")).toEqual([
        sessionId,
      ]);
      expect(victim.realm).toBe("tenant-b");
    });

    it("pages and counts a realm's own sessions only", async ({ expect }) => {
      const alepha = await boot();
      const realmProvider = alepha.inject(RealmProvider);
      const t = tag();
      const a = await realmProvider
        .userRepository("tenant-a")
        .create({ realm: "tenant-a", email: `a-${t}@example.com` });
      const b = await realmProvider
        .userRepository("tenant-b")
        .create({ realm: "tenant-b", email: `b-${t}@example.com` });
      const sessions = alepha.inject(SessionService);
      const own = await sessions.createSession(a as never, 3600, "tenant-a");
      await realmProvider
        .sessionRepository("tenant-a")
        .updateById(own.sessionId, { country: "FR" });
      // Three newer sessions of the other realm: they filled the first page.
      for (let i = 0; i < 3; i++) {
        const other = await sessions.createSession(
          b as never,
          3600,
          "tenant-b",
        );
        await realmProvider
          .sessionRepository("tenant-b")
          .updateById(other.sessionId, { country: "JP" });
      }
      const crud = alepha.inject(SessionCrudService);

      const page = await crud.findSessions({ size: 2 }, "tenant-a");

      expect(page.content.map((it) => it.id)).toEqual([own.sessionId]);
      expect(page.page.totalElements).toBe(1);
      expect(await crud.getSessionCountries("tenant-a")).toEqual(["FR"]);
      expect(await crud.getSessionCountries("tenant-b")).toEqual(["JP"]);
    });
  });

  describe("identities", () => {
    const withTotp = async (alepha: Alepha) => {
      const { victim } = await victimOfB(alepha);
      const mfa = alepha.inject(MfaService);
      const totp = alepha.inject(TotpService);
      const enrolment = await mfa.beginTotpEnrollment(victim.id, "tenant-b");
      await mfa.activateTotp(
        victim.id,
        totp.codeForCounter(enrolment.secret, totp.currentStep()),
        "tenant-b",
      );
      return victim;
    };

    it("lists a realm's own identities only when no user is named", async ({
      expect,
    }) => {
      const alepha = await boot();
      const victim = await withTotp(alepha);
      const identities = alepha.inject(IdentityService);

      const foreign = await identities.findIdentities(
        { size: 100 },
        "tenant-a",
      );
      expect(foreign.content.filter((it) => it.userId === victim.id)).toEqual(
        [],
      );
      expect(foreign.page.totalElements).toBe(0);

      const own = await identities.findIdentities({ size: 100 }, "tenant-b");
      expect(own.content.map((it) => it.provider)).toEqual(["totp"]);
    });

    it("never hands out the secret material of an identity", async ({
      expect,
    }) => {
      const alepha = await boot();
      const victim = await withTotp(alepha);
      await alepha
        .inject(RealmProvider)
        .identityRepository("tenant-b")
        .create({
          userId: victim.id,
          provider: "github",
          providerUserId: `gh-${tag()}`,
          providerData: { accessToken: "gho_secret", refreshToken: "ghr_x" },
        });
      const identities = alepha.inject(IdentityService);

      const page = await identities.findIdentities({ size: 100 }, "tenant-b");
      const resources = page.content.map((it) => identities.toResource(it));

      const totp = resources.find((it) => it.provider === "totp");
      expect(totp?.providerData).toEqual({
        status: "active",
        activatedAt: expect.any(String),
      });
      const github = resources.find((it) => it.provider === "github");
      expect(github?.providerData).toEqual({});

      // The response schema cannot carry it either, whatever the service
      // is handed.
      const row = page.content.find((it) => it.provider === "totp");
      const serialized = JSON.stringify(identityResourceSchema.parse(row));
      expect(serialized).not.toContain("secret");
      expect(serialized).not.toContain("recoveryCodes");
      expect(serialized).not.toContain("lastUsedStep");
    });
  });

  describe("email verification check", () => {
    const caller = (realm: string, id: string) =>
      ({ user: { id, roles: ["user"], realm } }) as never;

    it("refuses another realm and another account's address", async ({
      expect,
    }) => {
      const alepha = await boot();
      const realmProvider = alepha.inject(RealmProvider);
      const t = tag();
      const vip = `vip-${t}@example.com`;
      await realmProvider
        .userRepository("tenant-b")
        .create({ realm: "tenant-b", email: vip, emailVerified: true });
      const me = await realmProvider.userRepository("tenant-a").create({
        realm: "tenant-a",
        email: `me-${t}@example.com`,
        emailVerified: true,
      });
      const neighbour = await realmProvider
        .userRepository("tenant-b")
        .create({ realm: "tenant-b", email: `nb-${t}@example.com` });
      const controller = alepha.inject(UserController);

      await expect(
        controller.checkEmailVerification(
          { query: { email: vip, userRealmName: "tenant-b" } },
          caller("tenant-a", me.id),
        ),
      ).rejects.toThrow(ForbiddenError);
      await expect(
        controller.checkEmailVerification(
          { query: { email: vip } },
          caller("tenant-b", neighbour.id),
        ),
      ).rejects.toThrow(ForbiddenError);

      // The caller's own address still answers.
      expect(
        await controller.checkEmailVerification(
          { query: { email: me.email! } },
          caller("tenant-a", me.id),
        ),
      ).toEqual({ verified: true });
    });
  });
});

describe("alepha/api/users - avatars", () => {
  const boot = async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    alepha.with(AlephaOrmTestPostgres);
    alepha.with(AlephaSecurity);
    alepha.with(() => ({ realm: $realm({ features: { avatars: true } }) }));
    await alepha.start();
    return alepha;
  };

  const upload = (alepha: Alepha) =>
    alepha.inject(UserStorage).avatars.upload(
      alepha.inject(FileSystemProvider).createFile({
        text: "png",
        name: "a.png",
        type: "image/png",
      }),
    );

  it("does not let a realm admin reach another realm's avatar", async ({
    expect,
  }) => {
    const alepha = await boot();
    const realmProvider = alepha.inject(RealmProvider);
    realmProvider.register("tenant-b");
    const victim = await realmProvider
      .userRepository("tenant-b")
      .create({ realm: "tenant-b", email: `b-${tag()}@example.com` });
    const file = await upload(alepha);
    await realmProvider
      .userRepository("tenant-b")
      .updateById(victim.id, { picture: file.id });
    const admin = {
      user: {
        id: "00000000-0000-0000-0000-0000000000a1",
        roles: ["admin"],
        realm: "users",
      },
    } as never;
    const controller = alepha.inject(AdminAvatarController);

    await expect(
      controller.deleteUserAvatar({ params: { id: victim.id } }, admin),
    ).rejects.toThrow(NotFoundError);
    await expect(
      controller.updateUserAvatar(
        {
          params: { id: victim.id },
          body: {
            file: alepha.inject(FileSystemProvider).createFile({
              text: "png",
              name: "b.png",
              type: "image/png",
            }),
          },
        },
        admin,
      ),
    ).rejects.toThrow(NotFoundError);

    expect(await alepha.inject(UserStorage).avatars.exists(file.id)).toBe(true);
    expect(
      (await realmProvider.userRepository("tenant-b").getById(victim.id))
        .picture,
    ).toBe(file.id);
  });

  it("does not take a picture from the registration form", async ({
    expect,
  }) => {
    const alepha = await boot();
    const file = await upload(alepha);
    const registration = alepha.inject(RegistrationService);

    const intent = await registration.createRegistrationIntent({
      email: `new-${tag()}@example.com`,
      password: "SecurePassword123!",
      picture: file.id,
    } as never);
    const user = await registration.completeRegistration({
      intentId: intent.intentId,
    });

    expect(user.picture).toBeUndefined();
  });

  it("keeps a file another account's avatar still points at", async ({
    expect,
  }) => {
    const alepha = await boot();
    const users = alepha.inject(RealmProvider).userRepository();
    const storage = alepha.inject(UserStorage);
    const t = tag();
    const file = await upload(alepha);
    const victim = await users.create({
      email: `victim-${t}@example.com`,
      picture: file.id,
    });
    // However the id got there, a second row naming the same file.
    const other = await users.create({
      email: `other-${t}@example.com`,
      picture: file.id,
    });
    const controller = alepha.inject(MyAvatarController);

    await controller.deleteMyAvatar({}, {
      user: { id: other.id, realm: "users", sessionId: "s" },
    } as never);

    expect((await users.getById(other.id)).picture).toBeUndefined();
    expect(await storage.avatars.exists(file.id)).toBe(true);

    // Once the last row lets go of it, the file goes.
    await controller.deleteMyAvatar({}, {
      user: { id: victim.id, realm: "users", sessionId: "s" },
    } as never);
    expect(await storage.avatars.exists(file.id)).toBe(false);
  });
});
