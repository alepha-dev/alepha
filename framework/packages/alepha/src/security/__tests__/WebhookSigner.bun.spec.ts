import { describe, expect, it } from "bun:test";

import { Alepha } from "alepha";

import { WebhookSigner } from "../providers/WebhookSigner.ts";

// ---------------------------------------------------------------------------------------------------------------------

describe("WebhookSigner on Bun", () => {
  it("matches the Standard Webhooks reference vector", async () => {
    const signer = Alepha.create().inject(WebhookSigner);
    const headers = await signer.headers({
      id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
      timestamp: 1614265330,
      body: '{"test": 2432232314}',
      secrets: ["whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"],
    });
    expect(headers["webhook-signature"]).toBe(
      "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
    );
  });
});
