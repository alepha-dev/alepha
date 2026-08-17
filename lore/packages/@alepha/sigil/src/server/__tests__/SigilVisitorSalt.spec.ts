import { Alepha } from "alepha";
import { CryptoProvider } from "alepha/crypto";
import { describe, expect, it } from "vitest";
import { SigilProxyController } from "../SigilProxyController.ts";
import { SigilSinkProvider } from "../SigilSinkProvider.ts";

class FakeSink extends SigilSinkProvider {
  public ingested: Array<{ env: any; stamp: any }> = [];

  override async ingest(env: any, stamp: any = {}) {
    this.ingested.push({ env, stamp });
  }
}

const make = (env: Record<string, any> = {}) =>
  Alepha.create({
    env: {
      NODE_ENV: "production",
      APP_SECRET: "test-secret",
      SERVER_PORT: 0,
      ...env,
    },
  }).with({ provide: SigilSinkProvider, use: FakeSink });

/**
 * One request from the same visitor, through a container with the given env.
 */
const visitorFor = async (env: Record<string, any>): Promise<string> => {
  const alepha = make(env);
  const ctrl = alepha.inject(SigilProxyController);
  const sink = alepha.inject(SigilSinkProvider) as FakeSink;
  await alepha.start();

  await ctrl.ingest.run({
    body: { views: [{ path: "/" }] },
    headers: {
      host: "app.example.com",
      "cf-connecting-ip": "1.2.3.4",
      "user-agent": "UA",
    },
  } as any);

  return sink.ingested[0].stamp.visitor;
};

describe("visitor hash salting", () => {
  it("is not derivable from public inputs", async () => {
    // The regression guard. The salt used to be `hash("alepha-sigil:" + date)`,
    // so anyone holding a stored hash could confirm a guessed IP with one more
    // hash. If this ever matches again, the column has gone back to being a
    // lookup table.
    const visitor = await visitorFor({
      SIGIL_CONFIG: '{"project":"demo","sink":"https://sink.example.com"}',
      SIGIL_KEY: "tk_secret",
      SIGIL_SALT: "salt_secret",
    });

    const crypto = Alepha.create({
      env: { NODE_ENV: "production", APP_SECRET: "x", SERVER_PORT: 0 },
    }).inject(CryptoProvider);
    const utcDate = new Date().toISOString().slice(0, 10);
    const publicSalt = crypto.hash(`alepha-sigil:${utcDate}`);
    const guessable = crypto.hash(`app.example.com:1.2.3.4:UA:${publicSalt}`);

    expect(visitor).not.toBe(guessable);
  });

  it("differs between two apps that share everything but the salt", async () => {
    const a = await visitorFor({ SIGIL_SALT: "salt_a" });
    const b = await visitorFor({ SIGIL_SALT: "salt_b" });

    expect(a).not.toBe(b);
  });

  it("is stable for the same visitor and the same salt", async () => {
    const a = await visitorFor({ SIGIL_SALT: "salt_a" });
    const b = await visitorFor({ SIGIL_SALT: "salt_a" });

    expect(a).toBe(b);
  });

  it("falls back to APP_SECRET when SIGIL_SALT is unset", async () => {
    // The zero-config path. APP_SECRET is guaranteed present and strong in
    // production — SecretProvider refuses to boot on the built-in default — so
    // an app that sets no sigil variables at all still gets an unguessable
    // hash. The observable consequence is that APP_SECRET moves it.
    const a = await visitorFor({ APP_SECRET: "secret-one" });
    const b = await visitorFor({ APP_SECRET: "secret-two" });

    expect(a).not.toBe(b);
  });

  it("is unmoved by rotating the sigil credential", async () => {
    // The reason the fallback is APP_SECRET and not SIGIL_KEY: rotating a
    // leaked token must not silently restart the day's unique count.
    const a = await visitorFor({
      SIGIL_CONFIG: '{"project":"demo","sink":"https://sink.example.com"}',
      SIGIL_KEY: "tk_before_rotation",
    });
    const b = await visitorFor({
      SIGIL_CONFIG: '{"project":"demo","sink":"https://sink.example.com"}',
      SIGIL_KEY: "tk_after_rotation",
    });

    expect(a).toBe(b);
  });

  it("prefers SIGIL_SALT over APP_SECRET, so the two can be decoupled", async () => {
    const a = await visitorFor({
      APP_SECRET: "secret-before",
      SIGIL_SALT: "salt_stable",
    });
    const b = await visitorFor({
      APP_SECRET: "secret-after",
      SIGIL_SALT: "salt_stable",
    });

    expect(a).toBe(b);
  });

  it("is domain-separated from anything else derived from APP_SECRET", async () => {
    // Labelled derivation, HKDF-style. Hashing the secret with only the date
    // would collide with any other feature that reaches for the same obvious
    // construction later.
    const secret = "shared-app-secret";
    const visitor = await visitorFor({ APP_SECRET: secret });

    const crypto = Alepha.create({
      env: { NODE_ENV: "production", APP_SECRET: secret, SERVER_PORT: 0 },
    }).inject(CryptoProvider);
    const utcDate = new Date().toISOString().slice(0, 10);
    const unlabelled = crypto.hash(
      `app.example.com:1.2.3.4:UA:${crypto.hash(`${secret}:${utcDate}`)}`,
    );

    expect(visitor).not.toBe(unlabelled);
  });
});
