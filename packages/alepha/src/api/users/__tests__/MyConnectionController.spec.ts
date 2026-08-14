import { Alepha } from "alepha";
import { AlephaOAuth, OAuthClientService } from "alepha/api/oauth";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { AlephaSecurity, CryptoProvider } from "alepha/security";
import { NotFoundError } from "alepha/server";
import { describe, it } from "vitest";
import {
  AlephaApiUsers,
  MyConnectionController,
  RealmProvider,
} from "../index.ts";

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  alepha.with(AlephaOrmPostgres);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaOAuth);
  await alepha.start();

  const realmProvider = alepha.inject(RealmProvider);
  const crypto = alepha.inject(CryptoProvider);
  await realmProvider.sessionRepository().deleteMany({});
  await realmProvider.userRepository().deleteMany({});

  const user = await realmProvider.userRepository().create({
    username: `conn-${crypto.randomUUID().slice(0, 8)}`,
  });

  // Never `Date.now()` — the clock is injected so `travel()` / `pause()` work.
  const expiresAt = alepha
    .inject(DateTimeProvider)
    .now()
    .add(7, "days")
    .toISOString();

  const addSession = async (clientId?: string) =>
    realmProvider.sessionRepository().create({
      userId: user.id,
      refreshToken: crypto.randomUUID(),
      expiresAt,
      clientId,
    });

  return {
    alepha,
    controller: alepha.inject(MyConnectionController),
    realmProvider,
    crypto,
    user,
    addSession,
    expiresAt,
  };
};

type Ctx = Awaited<ReturnType<typeof setup>>;

const caller = (ctx: Ctx, sessionId: string) => ({
  user: { id: ctx.user.id, realm: "default", sessionId } as never,
});

const list = (ctx: Ctx, sessionId: string) =>
  ctx.controller.listMyConnections({}, caller(ctx, sessionId));

const revoke = (ctx: Ctx, sessionId: string, id: string) =>
  ctx.controller.revokeMyConnection({ params: { id } }, caller(ctx, sessionId));

describe("alepha/api/users - MyConnectionController", () => {
  it("should list only sessions that belong to an OAuth client", async ({
    expect,
  }) => {
    // A browser session has no clientId and belongs to the sessions page.
    const ctx = await setup();
    const browser = await ctx.addSession();
    await ctx.addSession("cli-tool");

    const connections = await list(ctx, browser.id);

    expect(connections).toHaveLength(1);
    expect(connections[0].clientId).toBe("cli-tool");
  });

  it("should resolve the client's registered display name", async ({
    expect,
  }) => {
    const ctx = await setup();
    const session = await ctx.addSession("claude-mcp");

    // Registered through the module's own service rather than by writing the
    // row: this is the shape a real client registration actually produces.
    await ctx.alepha.inject(OAuthClientService).register({
      realm: "default",
      clientId: "claude-mcp",
      clientName: "Claude",
      redirectUris: ["https://example.com/callback"],
    });

    const connections = await list(ctx, session.id);

    expect(connections[0].clientName).toBe("Claude");
  });

  it("should fall back to the client id when the registration is gone", async ({
    expect,
  }) => {
    // A session outlives a deleted client registration; a blank name would
    // read as a rendering bug rather than something still revocable.
    const ctx = await setup();
    const session = await ctx.addSession("deleted-client");

    const connections = await list(ctx, session.id);

    expect(connections[0].clientName).toBe("deleted-client");
  });

  it("should flag the connection making the request", async ({ expect }) => {
    const ctx = await setup();
    const mine = await ctx.addSession("cli-tool");
    await ctx.addSession("other-tool");

    const connections = await list(ctx, mine.id);

    expect(connections.find((c) => c.current)?.id).toBe(mine.id);
    expect(connections.filter((c) => c.current)).toHaveLength(1);
  });

  it("should never return the refresh token", async ({ expect }) => {
    const ctx = await setup();
    const session = await ctx.addSession("cli-tool");

    const connections = await list(ctx, session.id);

    expect(connections[0]).not.toHaveProperty("refreshToken");
  });

  it("should revoke one connection", async ({ expect }) => {
    const ctx = await setup();
    const mine = await ctx.addSession("cli-tool");
    const other = await ctx.addSession("other-tool");

    await revoke(ctx, mine.id, other.id);

    expect((await list(ctx, mine.id)).map((c) => c.id)).toEqual([mine.id]);
  });

  it("should refuse to revoke a plain browser session through this endpoint", async ({
    expect,
  }) => {
    /*
      Without the `clientId: isNotNull` condition, "revoke a connected app"
      would happily delete the browser session the caller is sitting in —
      that belongs to the sessions page and its own confirmation.
    */
    const ctx = await setup();
    const browser = await ctx.addSession();
    await ctx.addSession("cli-tool");

    await expect(revoke(ctx, browser.id, browser.id)).rejects.toThrowError(
      NotFoundError,
    );

    const survivor = await ctx.realmProvider
      .sessionRepository()
      .findOne({ where: { id: { eq: browser.id } } });
    expect(survivor).toBeTruthy();
  });

  it("should read another account's connection as missing", async ({
    expect,
  }) => {
    const ctx = await setup();
    const mine = await ctx.addSession("cli-tool");

    const stranger = await ctx.realmProvider
      .userRepository()
      .create({ username: "conn-stranger" });
    const theirs = await ctx.realmProvider.sessionRepository().create({
      userId: stranger.id,
      refreshToken: ctx.crypto.randomUUID(),
      expiresAt: ctx.expiresAt,
      clientId: "cli-tool",
    });

    // Not-found rather than forbidden: a distinct answer would confirm the id.
    await expect(revoke(ctx, mine.id, theirs.id)).rejects.toThrowError(
      NotFoundError,
    );

    const survivor = await ctx.realmProvider
      .sessionRepository()
      .findOne({ where: { id: { eq: theirs.id } } });
    expect(survivor).toBeTruthy();
  });
});
