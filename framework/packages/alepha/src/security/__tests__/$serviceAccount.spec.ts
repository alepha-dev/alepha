import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it } from "vitest";

import { $issuer, $serviceAccount } from "../index.ts";

const setup = async () => {
  const alepha = Alepha.create();

  class App {
    issuer = $issuer({
      secret: "your-issuer-secret",
    });

    jwt = $serviceAccount({
      issuer: this.issuer,
      user: {
        id: "service-account",
      },
    });
  }

  const app = alepha.inject(App);
  await alepha.start();

  return { app, time: alepha.inject(DateTimeProvider) };
};

describe("$serviceAccount", () => {
  it("should generate and cache JWT tokens with expiration", async ({
    expect,
  }) => {
    const { app, time } = await setup();

    const tk = await app.jwt.token();
    const parts = tk.split(".");
    expect(parts.length).toBe(3);
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64").toString("utf-8"),
    );
    expect(payload).toEqual({
      sub: "service-account",
      aud: "issuer",
      iat: expect.any(Number),
      exp: expect.any(Number),
      sid: expect.any(String),
    });

    // A second later a new token would carry another `iat`: the same string
    // back means it came from the cache.
    await time.travel([1, "second"]);
    expect(await app.jwt.token()).toBe(tk);

    // Past the access token's lifetime, a new one is minted.
    await time.travel([20, "minutes"]);
    expect(await app.jwt.token()).not.toBe(tk);
  });
});
