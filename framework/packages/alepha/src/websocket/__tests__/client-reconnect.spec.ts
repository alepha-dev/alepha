import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { $channel } from "../primitives/$channel.ts";
import { WebSocketClient } from "../services/WebSocketClient.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `reconnect()` closes the current socket and opens the next one at once.
 * The close event of the abandoned socket fires later, and its handler used
 * to clear `this.ws` (the NEW socket), flag the connection as down and
 * schedule another reconnect: one extra live socket per room subscription.
 */
describe("WebSocketClient reconnect", () => {
  it("keeps a single live socket after a second room subscription", async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise((resolve) => server.once("listening", resolve));
    const port = (server.address() as { port: number }).port;
    const live = new Set<unknown>();
    let opened = 0;
    server.on("connection", (ws) => {
      opened++;
      live.add(ws);
      ws.on("close", () => live.delete(ws));
    });

    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } });
    class Channels {
      chat = $channel({
        path: "/ws/chat",
        schema: {
          in: z.object({ text: z.string() }),
          out: z.object({ text: z.string() }),
        },
      });
    }
    const channels = alepha.inject(Channels);
    const client = alepha.inject(WebSocketClient);
    await alepha.start();

    const url = `ws://127.0.0.1:${port}/ws/chat`;
    const options = { url, reconnectInterval: 100 };
    const unsubscribeA = client.subscribe(
      "a",
      channels.chat,
      () => {},
      options,
    );
    await sleep(300);
    const connection = client.getConnection(channels.chat);
    expect(connection?.isConnected).toBe(true);

    const unsubscribeB = client.subscribe(
      "b",
      channels.chat,
      () => {},
      options,
    );
    await sleep(800);

    expect(opened).toBe(2);
    expect(live.size).toBe(1);
    expect(connection?.isConnected).toBe(true);

    unsubscribeA();
    unsubscribeB();
    await alepha.stop();
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  });
});
