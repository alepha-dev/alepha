import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { Alepha } from "alepha";
import { afterEach, describe, expect, it } from "vitest";

import { TurnstileCaptchaProvider } from "../providers/TurnstileCaptchaProvider.ts";

/**
 * What the fake siteverify received and what it should answer.
 */
interface FakeSiteverify {
  url: string;
  bodies: URLSearchParams[];
  status: number;
  answer: Record<string, unknown>;
  close: () => Promise<void>;
}

/**
 * A stand-in for Cloudflare's siteverify.
 *
 * `node:http` rather than an Alepha server: what is under test is the exact
 * `application/x-www-form-urlencoded` body the provider sends and how it
 * reads a raw status, and a bare server is the shortest way to see both
 * without a framework's body parsing in between.
 */
const startFakeSiteverify = async (): Promise<FakeSiteverify> => {
  const state = {
    bodies: [] as URLSearchParams[],
    status: 200,
    answer: { success: true } as Record<string, unknown>,
  };

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      state.bodies.push(new URLSearchParams(raw));
      res.writeHead(state.status, { "content-type": "application/json" });
      res.end(state.status === 200 ? JSON.stringify(state.answer) : "nope");
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/siteverify`,
    get bodies() {
      return state.bodies;
    },
    get status() {
      return state.status;
    },
    set status(value: number) {
      state.status = value;
    },
    get answer() {
      return state.answer;
    },
    set answer(value: Record<string, unknown>) {
      state.answer = value;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
};

describe("TurnstileCaptchaProvider", () => {
  let fake: FakeSiteverify | undefined;

  afterEach(async () => {
    await fake?.close();
    fake = undefined;
  });

  const provider = async (env: Record<string, string> = {}) => {
    fake = await startFakeSiteverify();
    const url = fake.url;

    class TestTurnstileCaptchaProvider extends TurnstileCaptchaProvider {
      protected readonly siteVerifyUrl = url;
    }

    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "silent",
        TURNSTILE_SECRET_KEY: "secret-key",
        TURNSTILE_SITE_KEY: "site-key",
        ...env,
      },
    });
    return {
      captcha: alepha.inject(TestTurnstileCaptchaProvider),
      fake: fake!,
    };
  };

  it("accepts a token siteverify approves", async () => {
    const { captcha, fake } = await provider();
    fake.answer = { success: true, hostname: "example.com", action: "login" };

    expect(await captcha.verify("token")).toBe(true);
  });

  it("refuses a token siteverify rejects", async () => {
    const { captcha, fake } = await provider();
    fake.answer = { success: false, "error-codes": ["invalid-input-response"] };

    expect(await captcha.verify("token")).toBe(false);
  });

  // A 5xx is not a verdict. The body was parsed anyway, so `success` came back
  // `undefined` and was returned: the right answer for the wrong reason, and
  // one that flips the day Cloudflare's error body grows a `success` field.
  it("refuses when siteverify answers a non-2xx", async () => {
    const { captcha, fake } = await provider();
    fake.status = 500;

    expect(await captcha.verify("token")).toBe(false);
  });

  it("sends the client address as remoteip", async () => {
    const { captcha, fake } = await provider();

    await captcha.verify("token", "203.0.113.7");

    expect(fake.bodies[0].get("secret")).toBe("secret-key");
    expect(fake.bodies[0].get("response")).toBe("token");
    expect(fake.bodies[0].get("remoteip")).toBe("203.0.113.7");
  });

  it("omits remoteip when the caller has no address", async () => {
    const { captcha, fake } = await provider();

    await captcha.verify("token");

    expect(fake.bodies[0].has("remoteip")).toBe(false);
  });

  describe("hostname and action pinning", () => {
    it("refuses a token solved on another hostname", async () => {
      const { captcha, fake } = await provider({
        TURNSTILE_EXPECTED_HOSTNAME: "example.com",
      });
      fake.answer = { success: true, hostname: "attacker.example" };

      expect(await captcha.verify("token")).toBe(false);
    });

    it("accepts a token solved on the expected hostname", async () => {
      const { captcha, fake } = await provider({
        TURNSTILE_EXPECTED_HOSTNAME: "example.com",
      });
      fake.answer = { success: true, hostname: "example.com" };

      expect(await captcha.verify("token")).toBe(true);
    });

    it("refuses a token solved for another action", async () => {
      const { captcha, fake } = await provider({
        TURNSTILE_EXPECTED_ACTION: "register",
      });
      fake.answer = { success: true, action: "login" };

      expect(await captcha.verify("token")).toBe(false);
    });

    // Both are opt-in: an app served from an apex and a `www` host has more
    // than one valid hostname, and pinning one would refuse the other.
    it("accepts any hostname and action when neither is configured", async () => {
      const { captcha, fake } = await provider();
      fake.answer = {
        success: true,
        hostname: "anything.example",
        action: "whatever",
      };

      expect(await captcha.verify("token")).toBe(true);
    });
  });
});
