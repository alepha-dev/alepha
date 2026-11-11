import { describe, it } from "vitest";

import { withWorkerd } from "../../ai/core/__tests__/workerdHarness.ts";

/**
 * The signer's WebCrypto path, bundled for workerd and run in Miniflare.
 */
describe("WebhookSigner (workerd)", () => {
  it("matches the Standard Webhooks reference vector on workerd", async ({
    expect,
  }) => {
    const result = await withWorkerd(
      {
        name: "webhook-signer",
        source: `
import { Alepha } from "alepha";
import { WebhookSigner } from "alepha/security";
export default { async fetch() {
 const signer = Alepha.create().inject(WebhookSigner);
 const headers = await signer.headers({ id: "msg_p5jXN8AQM9LWM0D4loKWxJek", timestamp: 1614265330, body: '{"test": 2432232314}', secrets: ["whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"] });
 return Response.json(headers);
} };
`,
      },
      async (dispatch) => (await dispatch({})).json(),
    );
    expect(result).toMatchObject({
      "webhook-signature": "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
    });
  }, 60_000);
});
