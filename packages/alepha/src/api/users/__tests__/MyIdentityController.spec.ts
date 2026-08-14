import { Alepha } from "alepha";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity, CryptoProvider } from "alepha/security";
import { BadRequestError, NotFoundError } from "alepha/server";
import { describe, it } from "vitest";
import {
  AlephaApiUsers,
  MyIdentityController,
  RealmProvider,
  SessionService,
} from "../index.ts";

const PASSWORD = "correct-horse-battery";

const setup = async (username: string) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiUsers);
  await alepha.start();

  const realmProvider = alepha.inject(RealmProvider);
  realmProvider.register("default", {
    settings: { username: "required" } as never,
  });
  await realmProvider.userRepository().deleteMany({});

  const user = await realmProvider.userRepository().create({ username });

  return {
    alepha,
    controller: alepha.inject(MyIdentityController),
    sessionService: alepha.inject(SessionService),
    crypto: alepha.inject(CryptoProvider),
    realmProvider,
    user,
    caller: { id: user.id, realm: "default", sessionId: "s-1" },
  };
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const addPasswordIdentity = async (ctx: Ctx) =>
  ctx.realmProvider.identityRepository().create({
    provider: "credentials",
    userId: ctx.user.id,
    password: await ctx.crypto.hashPassword(PASSWORD),
  });

const addOauthIdentity = async (ctx: Ctx, provider = "github") =>
  ctx.realmProvider.identityRepository().create({
    provider,
    userId: ctx.user.id,
    providerUserId: "12345",
    // The realistic shape: an OAuth identity carries the provider's own
    // credentials in this column.
    providerData: { accessToken: "gho_secret", refreshToken: "ghr_secret" },
  });

const list = (ctx: Ctx) =>
  ctx.controller.listMyIdentities({}, { user: ctx.caller as never });

const setFirstPassword = (ctx: Ctx, password: string) =>
  ctx.controller.setMyFirstPassword(
    { body: { password } },
    { user: ctx.caller as never },
  );

const unlink = (ctx: Ctx, id: string) =>
  ctx.controller.unlinkMyIdentity(
    { params: { id } },
    { user: ctx.caller as never },
  );

describe("alepha/api/users - MyIdentityController", () => {
  it("should list the caller's sign-in methods", async ({ expect }) => {
    const ctx = await setup("id-list");
    await addPasswordIdentity(ctx);
    await addOauthIdentity(ctx);

    const identities = await list(ctx);

    expect(identities.map((i) => i.provider).sort()).toEqual([
      "credentials",
      "github",
    ]);
  });

  it("should never return the password hash or the provider's own tokens", async ({
    expect,
  }) => {
    /*
      `providerData` routinely holds the OAuth provider's access and refresh
      tokens — leaking it is worse than leaking this account, because it is a
      working credential for a *different* service. `password` is the hash.
      Neither has any use in a UI.
    */
    const ctx = await setup("id-leak");
    await addPasswordIdentity(ctx);
    await addOauthIdentity(ctx);

    for (const identity of await list(ctx)) {
      expect(identity).not.toHaveProperty("password");
      expect(identity).not.toHaveProperty("providerData");
    }

    expect(JSON.stringify(await list(ctx))).not.toContain("gho_secret");
  });

  it("should set a first password on an account that has none", async ({
    expect,
  }) => {
    const ctx = await setup("id-first");
    await addOauthIdentity(ctx);

    await setFirstPassword(ctx, PASSWORD);

    const result = await ctx.sessionService.login(
      "credentials",
      "id-first",
      PASSWORD,
    );
    expect(result?.id).toBe(ctx.user.id);
  });

  it("should refuse to set a first password when one already exists", async ({
    expect,
  }) => {
    /*
      This endpoint asks for no current password — defensible only while
      there is nothing to prove knowledge of. Letting it through here would
      turn any unlocked, signed-in browser into a full account takeover with
      no credential needed. Changing goes through MyPasswordController.
    */
    const ctx = await setup("id-second");
    await addPasswordIdentity(ctx);

    await expect(
      setFirstPassword(ctx, "some-other-secret"),
    ).rejects.toThrowError(BadRequestError);
  });

  it("should leave the existing password working when the set is refused", async ({
    expect,
  }) => {
    const ctx = await setup("id-intact");
    await addPasswordIdentity(ctx);

    await expect(
      setFirstPassword(ctx, "some-other-secret"),
    ).rejects.toThrowError(BadRequestError);

    const result = await ctx.sessionService.login(
      "credentials",
      "id-intact",
      PASSWORD,
    );
    expect(result?.id).toBe(ctx.user.id);
  });

  it("should unlink one method when another remains", async ({ expect }) => {
    const ctx = await setup("id-unlink");
    await addPasswordIdentity(ctx);
    const oauth = await addOauthIdentity(ctx);

    await unlink(ctx, oauth.id);

    expect((await list(ctx)).map((i) => i.provider)).toEqual(["credentials"]);
  });

  it("should refuse to unlink the only remaining sign-in method", async ({
    expect,
  }) => {
    /*
      Removing it leaves the account unreachable forever — not locked, not
      disabled, just with no way in — from one click on a page with no undo.
      Password reset cannot recover it either: that needs a credentials
      identity to reset.
    */
    const ctx = await setup("id-last");
    const only = await addPasswordIdentity(ctx);

    await expect(unlink(ctx, only.id)).rejects.toThrowError(BadRequestError);

    expect(await list(ctx)).toHaveLength(1);
  });

  it("should read another account's identity as missing", async ({
    expect,
  }) => {
    const ctx = await setup("id-scope");
    await addPasswordIdentity(ctx);
    await addOauthIdentity(ctx);

    const stranger = await ctx.realmProvider
      .userRepository()
      .create({ username: "id-stranger" });
    const theirs = await ctx.realmProvider.identityRepository().create({
      provider: "credentials",
      userId: stranger.id,
      password: await ctx.crypto.hashPassword(PASSWORD),
    });

    // Not-found rather than forbidden: a distinct answer would confirm the id
    // exists, turning this into an enumeration oracle.
    await expect(unlink(ctx, theirs.id)).rejects.toThrowError(NotFoundError);

    const survivors = await ctx.realmProvider
      .identityRepository()
      .findMany({ where: { userId: { eq: stranger.id } } });
    expect(survivors).toHaveLength(1);
  });
});
