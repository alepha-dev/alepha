import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $issuer, AlephaSecurity } from "alepha/security";
import { AlephaServer, HttpClient, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

// Relative, never `alepha/server/auth`: the build's module analyzer scans
// test files too, and a barrel import from inside the module makes it depend
// on itself. `AlephaServerAuth` is registered explicitly below for the same
// reason, since importing the barrel is what used to pull it in.
import { alephaServerAuthRoutes } from "../constants/routes.ts";
import { AlephaServerAuth } from "../index.ts";
import { $auth, type WithSecondFactorFn } from "../primitives/$auth.ts";
import { tokenResponseSchema } from "../schemas/tokenResponseSchema.ts";

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
}

/**
 * Wire the seam the way `$realm` does, but without dragging a database in:
 * the gate belongs to `alepha/server/auth`, and it has to work for any
 * issuer that fills these in.
 */
const setup = async (options: { methods?: Array<"totp" | "emailCode"> }) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaServer)
    .with(AlephaSecurity)
    .with(AlephaServerAuth)
    .with(App);

  await alepha.start();

  const app = alepha.inject(App);
  const started: string[] = [];

  // The seam is read per request, so filling it after start is fine and
  // keeps the container's own wiring untouched.
  const issuer = app.issuer as typeof app.issuer & WithSecondFactorFn;
  issuer.secondFactor = () => options.methods ?? [];
  issuer.startSecondFactor = (_user, method) => {
    started.push(method);
    return { sentTo: method === "emailCode" ? "a***@example.com" : undefined };
  };
  issuer.verifySecondFactor = (_user, _method, code) => code === VALID_CODE;

  const hostname = alepha.inject(ServerProvider).hostname;
  const http = alepha.inject(HttpClient);

  return {
    alepha,
    started,
    dateTime: alepha.inject(DateTimeProvider),
    login: () =>
      http.fetch(`${hostname}${alephaServerAuthRoutes.token}?provider=auth`, {
        method: "POST",
        body: JSON.stringify({ username: "ada", password: "***" }),
        schema: { response: tokenResponseSchema },
      }),
    mfa: (body: { challenge: string; code: string }) =>
      http.fetch(`${hostname}${alephaServerAuthRoutes.mfa}?provider=auth`, {
        method: "POST",
        body: JSON.stringify(body),
        schema: { response: tokenResponseSchema },
      }),
  };
};

describe("alepha/server/auth - second factor gate", () => {
  it("should mint tokens directly when no second factor is required", async ({
    expect,
  }) => {
    const ctx = await setup({ methods: [] });

    const { data } = await ctx.login();

    expect(data.access_token).toBeTruthy();
    expect(ctx.started).toEqual([]);
  });

  it("should answer a challenge instead of tokens when a factor is required", async ({
    expect,
  }) => {
    const ctx = await setup({ methods: ["totp"] });

    const error: any = await ctx.login().catch((it) => it);

    expect(error.error).toBe("MfaRequiredError");
    expect(error.status).toBe(401);
    expect(error.data.methods).toEqual(["totp"]);
    expect(typeof error.data.challenge).toBe("string");
    // No session may exist yet: the password alone is not enough.
    expect(error.data.access_token).toBeUndefined();
    expect(ctx.started).toEqual(["totp"]);
  });

  it("should report where an out-of-band code was sent", async ({ expect }) => {
    const ctx = await setup({ methods: ["emailCode"] });

    const error: any = await ctx.login().catch((it) => it);

    expect(error.data.methods).toEqual(["emailCode"]);
    expect(error.data.sentTo).toBe("a***@example.com");
  });

  it("should mint tokens once the challenge is cleared", async ({ expect }) => {
    const ctx = await setup({ methods: ["totp"] });
    const error: any = await ctx.login().catch((it) => it);

    const { data } = await ctx.mfa({
      challenge: error.data.challenge,
      code: VALID_CODE,
    });

    expect(data.access_token).toBeTruthy();
    expect(data.user.id).toBe(user.id);
  });

  it("should refuse a challenge cleared with the wrong code", async ({
    expect,
  }) => {
    const ctx = await setup({ methods: ["totp"] });
    const error: any = await ctx.login().catch((it) => it);

    const failure: any = await ctx
      .mfa({ challenge: error.data.challenge, code: "000000" })
      .catch((it) => it);

    expect(failure.status).toBe(401);
    expect(failure.access_token).toBeUndefined();
  });

  it("should refuse a challenge that someone tampered with", async ({
    expect,
  }) => {
    const ctx = await setup({ methods: ["totp"] });
    const error: any = await ctx.login().catch((it) => it);

    // Flip the payload while keeping the structure: without a signature check
    // this is how an attacker would swap in another user id.
    const [payload, signature] = String(error.data.challenge).split(".");
    const decoded = JSON.parse(
      Buffer.from(payload!, "base64url").toString("utf8"),
    );
    decoded.sub = randomUUID();
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;

    const failure: any = await ctx
      .mfa({ challenge: forged, code: VALID_CODE })
      .catch((it) => it);

    expect(failure.status).toBe(401);
    expect(failure.access_token).toBeUndefined();
  });

  it("should refuse a challenge that has expired", async ({ expect }) => {
    const ctx = await setup({ methods: ["totp"] });
    const error: any = await ctx.login().catch((it) => it);

    await ctx.dateTime.travel(6, "minutes");

    const failure: any = await ctx
      .mfa({ challenge: error.data.challenge, code: VALID_CODE })
      .catch((it) => it);

    expect(failure.status).toBe(401);
    expect(failure.access_token).toBeUndefined();
  });
});
