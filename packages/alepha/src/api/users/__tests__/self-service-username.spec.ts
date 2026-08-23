import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity } from "alepha/security";
import { BadRequestError, ConflictError } from "alepha/server";
import { describe, expect, it } from "vitest";

import {
  AlephaApiUsers,
  MyProfileController,
  RealmProvider,
} from "../index.ts";

const suffix = () => Math.random().toString(36).slice(2, 8);

const boot = async (settings: Record<string, unknown>) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiUsers);
  await alepha.start();
  const realmProvider = alepha.inject(RealmProvider);
  realmProvider.register("default", { settings: settings as never });
  return alepha;
};

const caller = (id: string) => ({
  user: { id, realm: "default", sessionId: "s" } as never,
});

describe("PATCH /users/me username", () => {
  it("applies the realm's blocklist and format, like registration does", async () => {
    const alepha = await boot({
      usernameBlocklist: ["root"],
      usernameRegExp: "^[a-z]{3,10}$",
    });
    const tag = suffix();
    const users = alepha.inject(RealmProvider).userRepository();
    const user = await users.create({
      username: `renamer${tag}`.slice(0, 10),
      email: `renamer-${tag}@example.com`,
    });
    const controller = alepha.inject(MyProfileController);

    await expect(
      controller.updateMyProfile(
        { body: { username: "root" } } as never,
        caller(user.id),
      ),
    ).rejects.toThrow(BadRequestError);

    await expect(
      controller.updateMyProfile(
        { body: { username: "NOT_ALLOWED_123" } } as never,
        caller(user.id),
      ),
    ).rejects.toThrow(BadRequestError);

    const renamed = await controller.updateMyProfile(
      { body: { username: "fine" } } as never,
      caller(user.id),
    );
    expect(renamed.username).toBe("fine");
  });

  it("answers 409 for a name taken in another case", async () => {
    // The unique index is case-insensitive; the pre-check used to be exact,
    // so "Alice" passed it and hit the index as a driver error.
    const alepha = await boot({});
    const tag = suffix();
    const users = alepha.inject(RealmProvider).userRepository();
    await users.create({
      username: `alice${tag}`,
      email: `alice-${tag}@example.com`,
    });
    const bob = await users.create({
      username: `bob${tag}`,
      email: `bob-${tag}@example.com`,
    });
    const controller = alepha.inject(MyProfileController);

    await expect(
      controller.updateMyProfile(
        { body: { username: `Alice${tag}` } } as never,
        caller(bob.id),
      ),
    ).rejects.toThrow(ConflictError);
  });
});
