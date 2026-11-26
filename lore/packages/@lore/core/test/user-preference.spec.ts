import { Alepha } from "alepha";
import { AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { $repository, AlephaOrm } from "alepha/orm";
import { AlephaSecurity, type UserAccountToken } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { UserPreferenceController } from "../src/api/controllers/UserPreferenceController.ts";
import { userPreferences } from "../src/api/entities/userPreferences.ts";
import { LoreCoreApi } from "../src/api/index.ts";
import { USER_PREFERENCE_MAX_BYTES } from "../src/api/schemas/userPreferenceSchema.ts";
import { CoreTestEntities } from "../src/testing/index.ts";

class PreferenceEntities extends CoreTestEntities {
  preferences = $repository(userPreferences);
}

interface Ctx {
  alepha: Alepha;
  repos: PreferenceEntities;
  api: UserPreferenceController;
  me: UserAccountToken;
  other: UserAccountToken;
}

const setup = async (): Promise<Ctx> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(LoreCoreApi);
  const repos = alepha.inject(PreferenceEntities);
  await alepha.start();
  const me = await repos.users.create({});
  const other = await repos.users.create({});
  return {
    alepha,
    repos,
    api: alepha.inject(UserPreferenceController),
    me: { id: me.id, roles: ["user"] },
    other: { id: other.id, roles: ["user"] },
  };
};

/**
 * The caller's preferences on the server (#Q4417): what a DataTable
 * remembers, per user and key, so it follows them to another device.
 */
describe("UserPreferenceController", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const key = "lor.board.12";

  it("reads null for a key never written, then what was written", async ({
    expect,
  }) => {
    const before = await ctx.api.getMyPreference(
      { params: { key } },
      { user: ctx.me },
    );
    expect(before).toEqual({ key, value: null });

    const value = {
      filters: { status: ["todo"] },
      sort: { field: "rank", direction: "asc" },
    };
    const saved = await ctx.api.setMyPreference(
      { params: { key }, body: { value } },
      { user: ctx.me },
    );
    expect(saved).toEqual({ key, value });

    const after = await ctx.api.getMyPreference(
      { params: { key } },
      { user: ctx.me },
    );
    expect(after.value).toEqual(value);
  });

  it("replaces the value on a second write, on one row", async ({ expect }) => {
    await ctx.api.setMyPreference(
      { params: { key }, body: { value: { size: 20 } } },
      { user: ctx.me },
    );
    await ctx.api.setMyPreference(
      { params: { key }, body: { value: { size: 50 } } },
      { user: ctx.me },
    );
    const read = await ctx.api.getMyPreference(
      { params: { key } },
      { user: ctx.me },
    );
    expect(read.value).toEqual({ size: 50 });
    expect(await ctx.repos.preferences.count()).toBe(1);
  });

  it("keeps an emptied value as written, not as never written", async ({
    expect,
  }) => {
    await ctx.api.setMyPreference(
      { params: { key }, body: { value: {} } },
      { user: ctx.me },
    );
    const read = await ctx.api.getMyPreference(
      { params: { key } },
      { user: ctx.me },
    );
    expect(read.value).toEqual({});
  });

  it("scopes every key to the caller", async ({ expect }) => {
    await ctx.api.setMyPreference(
      { params: { key }, body: { value: { size: 50 } } },
      { user: ctx.me },
    );
    const theirs = await ctx.api.getMyPreference(
      { params: { key } },
      { user: ctx.other },
    );
    expect(theirs.value).toBeNull();
  });

  it("refuses a value past the size cap", async ({ expect }) => {
    await expect(
      ctx.api.setMyPreference(
        {
          params: { key },
          body: { value: { blob: "x".repeat(USER_PREFERENCE_MAX_BYTES) } },
        },
        { user: ctx.me },
      ),
    ).rejects.toThrow("at most");
  });

  it("refuses a key outside the pattern", async ({ expect }) => {
    await expect(
      ctx.api.getMyPreference(
        { params: { key: "has space" } },
        { user: ctx.me },
      ),
    ).rejects.toThrow();
  });

  it("deletes the preferences with the account", async ({ expect }) => {
    await ctx.api.setMyPreference(
      { params: { key }, body: { value: { size: 50 } } },
      { user: ctx.me },
    );
    await ctx.repos.users.deleteById(ctx.me.id);
    expect(await ctx.repos.preferences.count()).toBe(0);
  });
});
