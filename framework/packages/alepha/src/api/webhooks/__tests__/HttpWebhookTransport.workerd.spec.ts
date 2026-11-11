import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, it } from "vitest";

import { withWorkerd } from "../../../ai/core/__tests__/workerdHarness.ts";

/**
 * The HTTP transport's real path on workerd, where the first consumer
 * deploys: a redirect not followed, a body cut at 2 KB, a timeout. And
 * `verifyRequest` reading the bytes from `raw.web.req`, as on Workers.
 */
describe("HttpWebhookTransport (workerd)", () => {
  it("does not follow a redirect, caps the read and times out on workerd", async ({
    expect,
  }) => {
    const hits: string[] = [];
    const server: Server = createServer((req, res) => {
      hits.push(req.url ?? "");
      if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("x".repeat(10_000));
      } else if (req.url === "/redirect") {
        res.writeHead(302, { location: "/target" });
        res.end();
      } else if (req.url === "/slow") {
        setTimeout(() => {
          res.writeHead(200);
          res.end("late");
        }, 2_000);
      } else {
        res.writeHead(200);
        res.end("target");
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    try {
      const result = await withWorkerd(
        {
          name: "webhook-transport",
          source: `
import { Alepha } from "alepha";
import { HttpWebhookTransport } from "alepha/api/webhooks";
import { WebhookSigner, WebhookVerifier } from "alepha/security";
export default { async fetch(request) {
 const input = await request.json();
 const alepha = Alepha.create();
 const transport = alepha.inject(HttpWebhookTransport);
 transport.timeoutMs = 300;
 const out = {};
 for (const path of ["/big", "/redirect", "/slow"]) {
   try {
     const r = await transport.send({ url: input.base + path, headers: { "content-type": "application/json" }, body: "{}" });
     out[path] = { status: r.status, excerpt: r.bodyExcerpt.length };
   } catch (e) { out[path] = { error: e.message }; }
 }
 const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
 const body = '{ "id": "e1", "type": "order.paid", "data": {} }';
 const headers = await alepha.inject(WebhookSigner).headers({ id: "e1", timestamp: input.now, body, secrets: [secret] });
 const req = new Request("http://receiver.test/hooks", { method: "POST", headers, body });
 out.verified = await alepha.inject(WebhookVerifier).verifyRequest({ headers: Object.fromEntries(req.headers), raw: { web: { req } } }, { secret });
 return Response.json(out);
} };
`,
        },
        async (dispatch) =>
          (
            await dispatch({
              base: `http://127.0.0.1:${port}`,
              now: Math.floor(Date.now() / 1000),
            })
          ).json(),
      );
      expect(result).toEqual({
        "/big": { status: 200, excerpt: 2048 },
        "/redirect": { status: 302, excerpt: 0 },
        "/slow": {
          error: `Webhook request to 127.0.0.1:${port} failed: timed out`,
        },
        verified: { id: "e1", type: "order.paid", data: {} },
      });
      expect(hits).not.toContain("/target");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 60_000);
});
