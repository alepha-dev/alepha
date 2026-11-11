import { $inject, Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import {
  InvalidWebhookSignatureError,
  WebhookSigner,
  WebhookVerifier,
} from "alepha/security";
import { $route, AlephaServer, ServerProvider } from "alepha/server";
import { describe, it } from "vitest";

const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const other = `whsec_${btoa("o".repeat(32))}`;
const body = '{"id":"evt_1","type":"order.paid","data":{"total":10}}';

const setup = () => {
  const alepha = Alepha.create();
  const now = alepha.inject(DateTimeProvider).pause();
  const seconds = Math.floor(now.valueOf() / 1000);
  return {
    alepha,
    seconds,
    signer: alepha.inject(WebhookSigner),
    verifier: alepha.inject(WebhookVerifier),
  };
};

const reasonOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof InvalidWebhookSignatureError) {
      return { reason: error.data.reason, status: error.data.status };
    }
    throw error;
  }
  return undefined;
};

describe("WebhookVerifier", () => {
  it("accepts a genuine request", async ({ expect }) => {
    const { signer, verifier, seconds } = setup();
    const headers = await signer.headers({
      id: "evt_1",
      timestamp: seconds,
      body,
      secrets: [secret],
    });
    await expect(
      verifier.verify({ headers, body, secret }),
    ).resolves.toBeUndefined();
  });

  it("checks every v1 signature and every secret given, and ignores unknown versions", async ({
    expect,
  }) => {
    const { signer, verifier, seconds } = setup();
    const headers = await signer.headers({
      id: "evt_1",
      timestamp: seconds,
      body,
      secrets: [other, secret],
    });
    headers["webhook-signature"] =
      `v2,bm9wZQ== ${headers["webhook-signature"]}`;
    await expect(
      verifier.verify({ headers, body, secret }),
    ).resolves.toBeUndefined();
    await expect(
      verifier.verify({ headers, body, secret: ["whsec_AAAA", other] }),
    ).resolves.toBeUndefined();
  });

  it("refuses a body that is not the bytes signed", async ({ expect }) => {
    const { signer, verifier, seconds } = setup();
    const headers = await signer.headers({
      id: "evt_1",
      timestamp: seconds,
      body,
      secrets: [secret],
    });
    const reserialised = JSON.stringify(JSON.parse(body), null, 1);
    expect(
      await reasonOf(verifier.verify({ headers, body: reserialised, secret })),
    ).toEqual({ reason: "signature", status: 401 });
  });

  it("refuses a wrong secret, a missing header and a version-only header", async ({
    expect,
  }) => {
    const { signer, verifier, seconds } = setup();
    const headers = await signer.headers({
      id: "evt_1",
      timestamp: seconds,
      body,
      secrets: [secret],
    });
    expect(
      await reasonOf(verifier.verify({ headers, body, secret: other })),
    ).toMatchObject({ reason: "signature" });
    const { "webhook-id": _, ...missing } = headers;
    expect(
      await reasonOf(verifier.verify({ headers: missing, body, secret })),
    ).toMatchObject({ reason: "headers" });
    expect(
      await reasonOf(
        verifier.verify({
          headers: { ...headers, "webhook-signature": "v2,abc" },
          body,
          secret,
        }),
      ),
    ).toMatchObject({ reason: "signature" });
  });

  it("refuses a timestamp outside the tolerance, both ways", async ({
    expect,
  }) => {
    const { signer, verifier, seconds } = setup();
    for (const [offset, ok] of [
      [-299, true],
      [299, true],
      [-301, false],
      [301, false],
    ] as const) {
      const headers = await signer.headers({
        id: "evt_1",
        timestamp: seconds + offset,
        body,
        secrets: [secret],
      });
      const result = await reasonOf(verifier.verify({ headers, body, secret }));
      expect(result).toEqual(
        ok ? undefined : { reason: "timestamp", status: 401 },
      );
    }
    const headers = await signer.headers({
      id: "evt_1",
      timestamp: seconds - 600,
      body,
      secrets: [secret],
    });
    await expect(
      verifier.verify({ headers, body, secret, toleranceSeconds: 900 }),
    ).resolves.toBeUndefined();
  });

  it("verifyRequest reads the raw bytes of a $route without schema.body, and a failure answers 401", async ({
    expect,
  }) => {
    const received: unknown[] = [];
    class Receiver {
      verifier = $inject(WebhookVerifier);
      hooks = $route({
        method: "POST",
        path: "/hooks",
        handler: async (request) => {
          received.push(await this.verifier.verifyRequest(request, { secret }));
          return "ok";
        },
      });
    }
    const alepha = Alepha.create({ env: { SERVER_PORT: 0 } })
      .with(AlephaServer)
      .with(Receiver);
    await alepha.start();
    const url = `${alepha.inject(ServerProvider).hostname}/hooks`;
    const signer = alepha.inject(WebhookSigner);
    const timestamp = Math.floor(
      alepha.inject(DateTimeProvider).nowMillis() / 1000,
    );
    // Whitespace a parse-and-stringify would lose.
    const raw = '{ "id": "evt_1",  "type": "order.paid", "data": {} }';
    const headers = await signer.headers({
      id: "evt_1",
      timestamp,
      body: raw,
      secrets: [secret],
    });

    const good = await fetch(url, { method: "POST", headers, body: raw });
    expect(good.status).toBe(200);
    expect(received).toEqual([{ id: "evt_1", type: "order.paid", data: {} }]);

    const bad = await fetch(url, {
      method: "POST",
      headers,
      body: raw.replace("  ", " "),
    });
    expect(bad.status).toBe(401);
    await alepha.stop();
  });
});
