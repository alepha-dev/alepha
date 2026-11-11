import { createHmac } from "node:crypto";

import { Alepha } from "alepha";
import { WebhookSigner } from "alepha/security";
import { describe, it } from "vitest";

/**
 * The reference vector of the Standard Webhooks specification: a receiver
 * using any library that implements it verifies what this signer sends.
 */
const vector = {
  secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
  timestamp: 1614265330,
  body: '{"test": 2432232314}',
  signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
};

describe("WebhookSigner", () => {
  it("matches the Standard Webhooks reference vector", async ({ expect }) => {
    const signer = Alepha.create().inject(WebhookSigner);
    const headers = await signer.headers({
      id: vector.id,
      timestamp: vector.timestamp,
      body: vector.body,
      secrets: [vector.secret],
    });
    expect(headers).toEqual({
      "webhook-id": vector.id,
      "webhook-timestamp": String(vector.timestamp),
      "webhook-signature": vector.signature,
    });
  });

  it("signs bytes and a string the same, and agrees with node:crypto", async ({
    expect,
  }) => {
    const signer = Alepha.create().inject(WebhookSigner);
    const body = JSON.stringify({ city: "Zürich", emoji: "\u{1F680}" });
    const secret = `whsec_${Buffer.from("k".repeat(32)).toString("base64")}`;
    const fromString = await signer.sign("evt_1", 1794200000, body, secret);
    const fromBytes = await signer.sign(
      "evt_1",
      1794200000,
      new TextEncoder().encode(body),
      secret,
    );
    const expected = createHmac("sha256", Buffer.from("k".repeat(32)))
      .update(`evt_1.1794200000.${body}`)
      .digest("base64");
    expect(fromString).toBe(expected);
    expect(fromBytes).toBe(expected);
  });

  it("carries one signature per secret, space-separated", async ({
    expect,
  }) => {
    const signer = Alepha.create().inject(WebhookSigner);
    const headers = await signer.headers({
      id: vector.id,
      timestamp: vector.timestamp,
      body: vector.body,
      secrets: [`whsec_${btoa("x".repeat(32))}`, vector.secret],
    });
    const parts = headers["webhook-signature"].split(" ");
    expect(parts).toHaveLength(2);
    expect(parts[1]).toBe(vector.signature);
  });

  it("refuses to sign with no secret", async ({ expect }) => {
    const signer = Alepha.create().inject(WebhookSigner);
    await expect(
      signer.headers({ id: "a", timestamp: 1, body: "", secrets: [] }),
    ).rejects.toThrow("at least one secret");
  });
});
