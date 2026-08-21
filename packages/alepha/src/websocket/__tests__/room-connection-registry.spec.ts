import { Alepha, z } from "alepha";
import { NodeHttpServerProvider } from "alepha/server";
import { describe, expect, test } from "vitest";
import WebSocket from "ws";

import { AlephaWebSocket } from "../index.ts";
import { $channel } from "../primitives/$channel.ts";
import { $room } from "../primitives/$room.ts";
import { WebSocketServerProvider } from "../providers/WebSocketServerProvider.ts";

/**
 * `handleRoomConnection` never registered its socket in `this.connections`, so
 * `getConnections()` / `closeConnection()` could not see room sockets and the
 * stop hook's close-all loop skipped them. `wss.close()` on a `noServer`
 * instance does not close established sockets, so shutting the server down
 * tore rooms' TCP connections down abruptly instead of sending a `1001`.
 */
const messageSchema = z.object({ content: z.text() });

const waitForOpen = (ws: WebSocket) =>
  new Promise<void>((resolve) => ws.on("open", resolve));

const hostnameOf = (alepha: Alepha) =>
  alepha.inject(NodeHttpServerProvider).hostname.replace("http://", "ws://");

class RoomApp {
  ch = $channel({
    path: "/ws/registry",
    schema: { in: messageSchema, out: messageSchema },
  });

  room = $room({
    channel: this.ch,
    state: () => ({ hits: 0 }),
  });
}

const start = async () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
    .with(AlephaWebSocket)
    .with(RoomApp);
  await alepha.start();
  return {
    alepha,
    url: `${hostnameOf(alepha)}/ws/registry?roomId=lobby`,
    server: alepha.inject(WebSocketServerProvider),
  };
};

describe("room connections are visible to the management APIs", () => {
  test("getConnections() includes room sockets", async () => {
    const { alepha, url, server } = await start();

    const ws = new WebSocket(url);
    await waitForOpen(ws);

    expect(server.getConnections().length).toBeGreaterThan(0);

    ws.close();
    await alepha.stop();
  });

  test("closeConnection() can close a room socket", async () => {
    const { alepha, url, server } = await start();

    const ws = new WebSocket(url);
    await waitForOpen(ws);

    const closed = new Promise<number>((resolve) =>
      ws.on("close", (code) => resolve(code)),
    );

    const [connection] = server.getConnections();
    await server.closeConnection(connection.id, 4000, "bye");

    expect(await closed).toBe(4000);

    await alepha.stop();
  });

  test("shutting down closes room sockets with 1001, not an abrupt teardown", async () => {
    const { alepha, url } = await start();

    const ws = new WebSocket(url);
    await waitForOpen(ws);

    const closed = new Promise<number>((resolve) =>
      ws.on("close", (code) => resolve(code)),
    );

    await alepha.stop();

    // 1001 "going away" — an abrupt TCP teardown surfaces as 1006.
    expect(await closed).toBe(1001);
  });

  test("a closed room socket is removed from the registry", async () => {
    const { alepha, url, server } = await start();

    const ws = new WebSocket(url);
    await waitForOpen(ws);
    expect(server.getConnections().length).toBe(1);

    ws.close();
    await expect.poll(() => server.getConnections().length).toBe(0);

    await alepha.stop();
  });
});
