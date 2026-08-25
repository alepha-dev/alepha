import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { $issuer, AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer, ServerProvider } from "alepha/server";
import { $auth, type WithSecondFactorFn } from "alepha/server/auth";
import { $client } from "alepha/server/links";
import { describe, it } from "vitest";

import { isMfaRequired, ReactAuth, type ReactAuthProvider } from "../index.ts";

const user = {
  id: randomUUID(),
  name: "Ada Lovelace",
  username: "ada",
  roles: ["user"],
};

const VALID_CODE = "123456";

class App {
  issuer = $issuer({
    secret: "my-secret-key",
    roles: [{ name: "user", default: true, permissions: [{ name: "*" }] }],
  });

  auth = $auth({
    issuer: this.issuer,
    credentials: {
      account: () => user,
    },
  });

  api = $client<ReactAuthProvider>();
}

const setup = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(App);

  await alepha.start();

  const issuer = alepha.inject(App).issuer as typeof App.prototype.issuer &
    WithSecondFactorFn;
  issuer.secondFactor = () => ["emailCode"];
  issuer.startSecondFactor = () => ({ sentTo: "a**@example.com" });
  issuer.verifySecondFactor = (_user, _method, code) => code === VALID_CODE;

  return {
    alepha,
    auth: alepha.inject(ReactAuth),
    hostname: alepha.inject(ServerProvider).hostname,
  };
};

describe("alepha/react/auth - second factor", () => {
  it("should surface the challenge instead of signing the user in", async ({
    expect,
  }) => {
    const ctx = await setup();

    const error = await ctx.auth
      .login("auth", {
        username: "ada",
        password: "***",
        hostname: ctx.hostname,
      })
      .catch((it) => it);

    expect(isMfaRequired(error)).toBe(true);
    expect(error.data.methods).toEqual(["emailCode"]);
    expect(error.data.sentTo).toBe("a**@example.com");
    // Nothing may be signed in yet.
    expect(ctx.alepha.store.get(currentUserAtom)).toBeUndefined();
  });

  it("should sign the user in once the code clears", async ({ expect }) => {
    const ctx = await setup();
    const error = await ctx.auth
      .login("auth", {
        username: "ada",
        password: "***",
        hostname: ctx.hostname,
      })
      .catch((it) => it);

    const tokens = await ctx.auth.loginMfa(error.data.challenge, VALID_CODE, {
      hostname: ctx.hostname,
    });

    expect(tokens.access_token).toBeTruthy();
    expect(ctx.alepha.store.get(currentUserAtom)?.id).toBe(user.id);
  });

  it("should keep the user signed out on a wrong code", async ({ expect }) => {
    const ctx = await setup();
    const error = await ctx.auth
      .login("auth", {
        username: "ada",
        password: "***",
        hostname: ctx.hostname,
      })
      .catch((it) => it);

    await expect(
      ctx.auth.loginMfa(error.data.challenge, "000000", {
        hostname: ctx.hostname,
      }),
    ).rejects.toThrowError();

    expect(ctx.alepha.store.get(currentUserAtom)).toBeUndefined();
  });

  it("should not treat an ordinary failure as a second-factor challenge", async ({
    expect,
  }) => {
    expect(isMfaRequired(new Error("boom"))).toBe(false);
    expect(isMfaRequired(undefined)).toBe(false);
  });
});
