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

  /**
   * The default gives up after ten attempts three seconds apart, so a tab
   * left open through a thirty-second outage never came back. With
   * `maxReconnectAttempts: -1` it retries forever, `maxReconnectInterval`
   * keeps those retries cheap, and `onConnect` firing again is how the page
   * learns it missed frames and must refetch.
   */
  it("comes back after more failed attempts than the default cap, and says so through onConnect", async () => {
    const listen = (port = 0) =>
      new Promise<WebSocketServer>((resolve) => {
        const created = new WebSocketServer({ port });
        created.once("listening", () => resolve(created));
      });
    let server = await listen();
    const port = (server.address() as { port: number }).port;

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

    let connects = 0;
    const unsubscribe = client.subscribe("a", channels.chat, () => {}, {
      url: `ws://127.0.0.1:${port}/ws/chat`,
      reconnectInterval: 10,
      maxReconnectInterval: 40,
      maxReconnectAttempts: -1,
      onConnect: () => {
        connects++;
      },
    });
    await sleep(200);
    expect(connects).toBe(1);

    // Down long enough for well over ten failed attempts.
    for (const ws of server.clients) ws.terminate();
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    await sleep(800);
    const connection = client.getConnection(channels.chat);
    expect(connection?.isConnected).toBe(false);

    server = await listen(port);
    await sleep(300);

    expect(connection?.isConnected).toBe(true);
    expect(connects).toBe(2);

    unsubscribe();
    await alepha.stop();
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  });
});
