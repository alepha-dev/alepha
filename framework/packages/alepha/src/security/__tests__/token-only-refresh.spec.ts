import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";

import {
  $issuer,
  $secure,
  AlephaSecurity,
  InvalidTokenError,
  JwtProvider,
  SecurityError,
  SecurityProvider,
} from "../index.ts";

/**
 * Two realms of one application sign with the same key, which is the default.
 * `admin` means everything in `a` and one read in `b`, and `u1` exists in
 * both.
 */
const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
  const secret = "token-only-refresh-test-secret-0123456789";

  class App {
    declared = $secure({ permissions: ["a:read", "a:write"] });

    a = $issuer({
      name: "a",
      secret,
      roles: [{ name: "admin", permissions: [{ name: "*" }] }],
    });

    b = $issuer({
      name: "b",
      secret,
      roles: [{ name: "admin", permissions: [{ name: "a:read" }] }],
    });
  }

  alepha.with(AlephaSecurity);
  const app = alepha.inject(App);
  await alepha.start();

  return {
    alepha,
    app,
    jwt: alepha.inject(JwtProvider),
    security: alepha.inject(SecurityProvider),
    time: alepha.inject(DateTimeProvider),
  };
};

describe("token-only refresh", () => {
  it("mints a new access token from an expired one, keeping its roles and session", async ({
    expect,
  }) => {
    const { app, time } = await setup();

    const first = await app.a.createToken({ id: "u1", roles: ["admin"] });
    await time.travel(1, "hour");

    const { tokens, user } = await app.a.refreshToken(
      first.refresh_token!,
      first.access_token,
    );

    expect(user.roles).toEqual(["admin"]);
    const before = await app.a.parseToken(first.refresh_token!);
    const after = await app.a.parseToken(tokens.access_token);
    expect(after.aud).toBe("a");
    expect(after.sid).toBe(before.sid);
  });

  it("refuses another realm's access token, whose roles mean something else here", async ({
    expect,
  }) => {
    const { app } = await setup();

    const ofA = await app.a.createToken({ id: "u1", roles: [] });
    const ofB = await app.b.createToken({ id: "u1", roles: ["admin"] });

    await expect(
      app.a.refreshToken(ofA.refresh_token!, ofB.access_token),
    ).rejects.toThrow(InvalidTokenError);
  });

  it("refuses a refresh token presented as the access token", async ({
    expect,
  }) => {
    const { app } = await setup();

    const tokens = await app.a.createToken({ id: "u1", roles: [] });

    await expect(
      app.a.refreshToken(tokens.refresh_token!, tokens.refresh_token!),
    ).rejects.toThrow(InvalidTokenError);
  });

  it("refuses an access token of another session of the same user", async ({
    expect,
  }) => {
    const { app } = await setup();

    // An earlier sign-in, when the user still held `admin`.
    const earlier = await app.a.createToken({ id: "u1", roles: ["admin"] });
    const current = await app.a.createToken({ id: "u1", roles: [] });

    await expect(
      app.a.refreshToken(current.refresh_token!, earlier.access_token),
    ).rejects.toThrow(InvalidTokenError);
  });

  it("refuses an access token of another user", async ({ expect }) => {
    const { app } = await setup();

    const mine = await app.a.createToken({ id: "u1", roles: [] });
    const theirs = await app.a.createToken({ id: "u2", roles: ["admin"] });

    await expect(
      app.a.refreshToken(mine.refresh_token!, theirs.access_token),
    ).rejects.toThrow(InvalidTokenError);
  });
});

describe("createUserFromToken", () => {
  it("accepts an access token of the realm it names", async ({ expect }) => {
    const { app, security } = await setup();

    const { access_token } = await app.a.createToken({
      id: "u1",
      roles: ["admin"],
    });

    const user = await security.createUserFromToken(`Bearer ${access_token}`, {
      realm: "a",
      permission: "a:write",
    });

    expect(user).toMatchObject({
      id: "u1",
      realm: "a",
      roles: ["admin"],
      ownership: false,
      token: access_token,
    });
  });

  it("finds the realm an access token was minted for when none is named", async ({
    expect,
  }) => {
    const { app, security } = await setup();

    const { access_token } = await app.b.createToken({
      id: "u1",
      roles: ["admin"],
    });

    const user = await security.createUserFromToken(access_token);
    expect(user.realm).toBe("b");
  });

  it("refuses a token minted for another realm, and one that is not an access token", async ({
    expect,
  }) => {
    const { app, security } = await setup();

    const ofB = await app.b.createToken({ id: "u1", roles: ["admin"] });

    await expect(
      security.createUserFromToken(ofB.access_token, { realm: "a" }),
    ).rejects.toThrow(InvalidTokenError);
    await expect(
      security.createUserFromToken(ofB.refresh_token, { realm: "b" }),
    ).rejects.toThrow(InvalidTokenError);
    await expect(
      security.createUserFromToken(ofB.refresh_token),
    ).rejects.toThrow(InvalidTokenError);
  });

  it("refuses a permission the token's permission scope leaves out", async ({
    expect,
  }) => {
    const { jwt, security, time } = await setup();

    const scoped = await jwt.create(
      {
        sub: "u1",
        aud: "a",
        exp: time.now().unix() + 600,
        roles: ["admin"],
        client_id: "app1",
        permission_scope: ["a:read"],
      },
      "a",
      { header: { typ: jwt.accessTokenTyp } },
    );

    const user = await security.createUserFromToken(scoped, {
      realm: "a",
      permission: "a:read",
    });
    expect(user.permissionScope).toEqual(["a:read"]);

    await expect(
      security.createUserFromToken(scoped, {
        realm: "a",
        permission: "a:write",
      }),
    ).rejects.toThrow(SecurityError);
  });
});
