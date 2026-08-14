import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { ConflictError } from "alepha/server";
import { describe, it } from "vitest";
import {
  AlephaApiUsers,
  MyProfileController,
  RealmProvider,
} from "../index.ts";

const setup = async (username: string) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiUsers);
  await alepha.start();

  const realmProvider = alepha.inject(RealmProvider);
  // Shared Postgres across runs: a leftover row with the same username would
  // be found by the uniqueness check and read as somebody else's claim.
  await realmProvider.userRepository().deleteMany({});

  const user = await realmProvider.userRepository().create({
    username,
    email: `${username}@example.com`,
    firstName: "Ada",
  });

  return {
    controller: alepha.inject(MyProfileController),
    realmProvider,
    user,
    caller: { id: user.id, realm: "default", sessionId: "s-1" },
  };
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const read = (ctx: Ctx) =>
  ctx.controller.getMyProfile({}, { user: ctx.caller as never });

const update = (ctx: Ctx, body: Record<string, unknown>) =>
  ctx.controller.updateMyProfile({ body } as never, {
    user: ctx.caller as never,
  });

describe("alepha/api/users - MyProfileController", () => {
  it("should return the caller's own profile", async ({ expect }) => {
    const ctx = await setup("prof-read");

    const profile = await read(ctx);

    expect(profile.id).toBe(ctx.user.id);
    expect(profile.username).toBe("prof-read");
    expect(profile.firstName).toBe("Ada");
  });

  it("should publish exactly the allowlisted fields and nothing else", async ({
    expect,
  }) => {
    /*
      The reason this controller has its own schema instead of returning
      `users.schema`: `realm`, `enabled` and `version` are the operator's
      business. But the real risk is not today's three — it is that returning
      the row wholesale publishes every column added to `users` in future, on
      the day it lands, with nobody deciding that it should be.

      So this asserts the whole key set rather than spot-checking the three.
      Widening the response then requires editing this list, which is the
      deliberate act the allowlist exists to force. Verified by mutation:
      swapping the response schema for `users.schema` turns this red.

      The response schema is what enforces it — `$action` validates and strips
      on the way out — so the projection in `toMyProfile` is a second layer,
      not the guard. Assert against the endpoint, not the helper.
    */
    const ctx = await setup("prof-leak");

    const profile = await read(ctx);

    expect(Object.keys(profile).sort()).toEqual([
      "createdAt",
      "email",
      "emailVerified",
      "firstName",
      "id",
      "lastLoginAt",
      "lastName",
      "phoneNumber",
      "picture",
      "roles",
      "username",
    ]);
  });

  it("should update the caller's own name", async ({ expect }) => {
    const ctx = await setup("prof-update");

    const updated = await update(ctx, {
      firstName: "Grace",
      lastName: "Hopper",
    });

    expect(updated.firstName).toBe("Grace");
    expect(updated.lastName).toBe("Hopper");
    expect((await read(ctx)).lastName).toBe("Hopper");
  });

  it("should refuse a username another account already holds", async ({
    expect,
  }) => {
    const ctx = await setup("prof-mine");
    await ctx.realmProvider
      .userRepository()
      .create({ username: "prof-theirs" });

    // A 409 rather than the driver's unique-index error, which phrases itself
    // differently per backend and would surface as a 500.
    await expect(update(ctx, { username: "prof-theirs" })).rejects.toThrowError(
      ConflictError,
    );
  });

  it("should allow re-submitting the username the caller already holds", async ({
    expect,
  }) => {
    // A form that PATCHes every field on save sends the unchanged username
    // back. Reading that as a collision with yourself would make the profile
    // page impossible to save.
    const ctx = await setup("prof-same");

    const updated = await update(ctx, {
      username: "prof-same",
      firstName: "Ada",
    });

    expect(updated.username).toBe("prof-same");
  });

  it("should leave the stored username untouched when the change is refused", async ({
    expect,
  }) => {
    const ctx = await setup("prof-intact");
    await ctx.realmProvider
      .userRepository()
      .create({ username: "prof-occupied" });

    await expect(
      update(ctx, { username: "prof-occupied" }),
    ).rejects.toThrowError(ConflictError);

    expect((await read(ctx)).username).toBe("prof-intact");
  });
});
