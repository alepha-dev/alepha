import { connect } from "node:net";

import { Alepha, type Middleware, z } from "alepha";
import { NodeHttpServerProvider } from "alepha/server";
import { describe, it } from "vitest";

import { AlephaWebSocket } from "../index.ts";
import { $channel } from "../primitives/$channel.ts";
import { $websocket } from "../primitives/$websocket.ts";

/**
 * A WebSocket's admission middlewares run under a signal aborted when the
 * socket closes before admission decided (#E85).
 */
describe("WebSocket admission signal", () => {
  it("aborts the admission's ambient signal when the socket closes mid-admission", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaWebSocket);
    let entered!: () => void;
    const entering = new Promise<void>((r) => {
      entered = r;
    });
    let aborted!: () => void;
    const aborting = new Promise<void>((r) => {
      aborted = r;
    });

    // A middleware that blocks until its ambient signal fires.
    const blocking = ((handler: (...args: any[]) => any) =>
      async (...args: any[]) => {
        const signal = alepha.context.signal;
        entered();
        await new Promise((resolve) => {
          signal.addEventListener("abort", resolve, { once: true });
        });
        aborted();
        return handler(...args);
      }) as Middleware;

    class Controller {
      ch = $channel({
        path: "/ws/slow-admission",
        schema: {
          in: z.object({ t: z.text() }),
          out: z.object({ t: z.text() }),
        },
      });
      ws = $websocket({
        channel: this.ch,
        handler: async () => {},
        use: [blocking],
      });
    }
    alepha.inject(Controller);
    await alepha.start();

    const url = new URL(alepha.inject(NodeHttpServerProvider).hostname);
    const socket = connect(Number(url.port), url.hostname);
    await new Promise<void>((r) => socket.once("connect", () => r()));
    socket.write(
      [
        "GET /ws/slow-admission HTTP/1.1",
        `Host: ${url.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n"),
    );
    await entering;
    socket.destroy();

    // Resolves only once the middleware's ambient signal fired.
    await expect(aborting).resolves.toBeUndefined();
  });
});
