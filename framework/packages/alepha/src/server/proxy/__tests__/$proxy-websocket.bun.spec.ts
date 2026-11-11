import { afterEach, describe, expect, it } from "bun:test";
import { request } from "node:http";

import { Alepha } from "alepha";
import { ServerProvider } from "alepha/server";

import { $proxy } from "../index.ts";

/**
 * On Bun, `Bun.serve` runs with no WebSocket handler, so a websocket proxy
 * refuses the upgrade with 501 rather than hanging or forwarding it as HTTP
 * (#Q3351).
 */
describe("$proxy websocket (Bun)", () => {
  let alepha: Alepha | undefined;

  afterEach(async () => {
    await alepha?.stop().catch(() => {});
  });

  it("refuses the upgrade with 501", async () => {
    class Front {
      ws = $proxy({
        path: "/live/*",
        target: "http://127.0.0.1:9",
        websocket: true,
      });
    }
    alepha = Alepha.create({ env: { NODE_ENV: "test" } }).with(Front);
    await alepha.start();
    const url = new URL(`${alepha.inject(ServerProvider).hostname}/live/feed`);

    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: {
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-version": "13",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        },
      });
      req.on("response", (res) => resolve(res.statusCode));
      req.on("upgrade", (res) => resolve(res.statusCode));
      req.on("error", reject);
      req.end();
    });

    expect(status).toBe(501);
  });
});
