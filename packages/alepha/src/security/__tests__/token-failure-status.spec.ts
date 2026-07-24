import { randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $route, ServerProvider } from "alepha/server";
import { describe, expect, it } from "vitest";
import { $issuer, $secure, AlephaSecurity } from "../index.ts";
import { JwtProvider } from "../providers/JwtProvider.ts";

class TestApp {
  realm = $issuer({
    secret: "test-secret",
    roles: [{ name: "user", permissions: [{ name: "*" }] }],
  });

  secured = $route({
    path: "/secured",
    use: [$secure()],
    handler: () => "ok",
  });
}

const createApp = () => {
  const alepha = Alepha.create().with(TestApp).with(AlephaSecurity);
  return {
    alepha,
    app: alepha.inject(TestApp),
    jwt: alepha.inject(JwtProvider),
    time: alepha.inject(DateTimeProvider),
  };
};

describe("token failure status", () => {
  // 401 is what tells a client to refresh or re-authenticate; 403 says
  // "authenticated, but not allowed" and stops a refresh flow dead. The
  // `$secure` middleware happens to swallow these and answer 401 itself, but
  // every direct `jwt.parse` caller (issuer refresh, OAuth code exchange)
  // propagates the error as-is.
  it("should carry status 401 when a token is malformed", async () => {
    const { alepha, jwt } = createApp();
    await alepha.start();

    const error = await jwt.parse("not-a-jwt").catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as { status?: number }).status).toBe(401);
  });

  it("should carry status 401 when a token is expired", async () => {
    const { alepha, app, jwt, time } = createApp();
    await alepha.start();

    const { access_token } = await app.realm.createToken({
      id: randomUUID(),
      roles: ["user"],
    });

    await time.travel([2, "days"]);

    const error = await jwt.parse(access_token).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as { status?: number }).status).toBe(401);
  });

  it("should still answer 403 when an authenticated user is not allowed", async () => {
    // A valid token from the wrong realm is an authorization denial, not an
    // authentication failure — that distinction is the point.
    class RealmApp {
      realmA = $issuer({
        name: "realmA",
        secret: "secret-a",
        roles: [{ name: "user", permissions: [{ name: "*" }] }],
      });

      realmB = $issuer({
        name: "realmB",
        secret: "secret-b",
        roles: [{ name: "user", permissions: [{ name: "*" }] }],
      });

      onlyB = $route({
        path: "/only-b",
        use: [$secure({ issuers: ["realmB"] })],
        handler: () => "ok",
      });
    }

    const alepha = Alepha.create().with(RealmApp).with(AlephaSecurity);
    const app = alepha.inject(RealmApp);
    await alepha.start();

    const { access_token } = await app.realmA.createToken({
      id: randomUUID(),
      roles: ["user"],
    });

    const res = await fetch(
      `${alepha.inject(ServerProvider).hostname}/only-b`,
      {
        headers: { authorization: `Bearer ${access_token}` },
      },
    );

    expect(res.status).toBe(403);
  });
});
