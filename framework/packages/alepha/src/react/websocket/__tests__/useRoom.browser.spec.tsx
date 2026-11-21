import { createRequire } from "node:module";

import { act, render, waitFor } from "@testing-library/react";
import { Alepha, z } from "alepha";
import { AlephaContext } from "alepha/react";
import { $channel, WebSocketClient } from "alepha/websocket";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WebSocketServer as WebSocketServerType } from "ws";

import { useRoom, type UseRoomReturn } from "../hooks/useRoom.tsx";

/**
 * `useRoom` against the real `WebSocketClient` and a real socket server:
 * what the hook reports must be what the client holds.
 */
describe("useRoom", () => {
  class Channels {
    chat = $channel({
      path: "/ws/chat",
      schema: {
        in: z.object({ text: z.string() }),
        out: z.object({ text: z.string() }),
      },
    });
  }

  // Through `require`: under jsdom an `import` of `ws` resolves to its
  // browser entry, which has no server. Its client stands in for the
  // browser's `WebSocket` too: the one this environment exposes is Node's,
  // whose events jsdom's `EventTarget` refuses.
  const ws = createRequire(import.meta.url)("ws") as {
    WebSocketServer: typeof WebSocketServerType;
    WebSocket: typeof WebSocket;
  };
  const { WebSocketServer } = ws;
  const nativeWebSocket = globalThis.WebSocket;

  let server: WebSocketServerType;
  let url: string;
  let received: string[];

  beforeEach(async () => {
    globalThis.WebSocket = ws.WebSocket;
    server = new WebSocketServer({ port: 0 });
    await new Promise((resolve) => server.once("listening", resolve));
    const port = (server.address() as { port: number }).port;
    url = `ws://127.0.0.1:${port}/ws/chat`;
    received = [];
    server.on("connection", (ws) => {
      ws.on("message", (data) =>
        received.push((data as Buffer).toString("utf8")),
      );
    });
  });

  afterEach(async () => {
    globalThis.WebSocket = nativeWebSocket;
    for (const ws of server.clients) {
      ws.terminate();
    }
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  });

  const setup = async () => {
    const alepha = Alepha.create();
    const channels = alepha.inject(Channels);
    const client = alepha.inject(WebSocketClient);
    await alepha.start();

    const rooms: Record<string, UseRoomReturn<any>> = {};
    const Room = (props: { id: string }) => {
      rooms[props.id] = useRoom(
        {
          roomId: props.id,
          channel: channels.chat,
          handler: () => {},
          url,
          autoReconnect: false,
        },
        [props.id],
      );
      return null;
    };
    const mount = (id: string) =>
      render(
        <AlephaContext.Provider value={alepha}>
          <Room id={id} />
        </AlephaContext.Provider>,
      );

    return { alepha, channels, client, rooms, mount };
  };

  it("reports the connection, and its end after disconnect()", async () => {
    const { rooms, mount, client, channels } = await setup();
    mount("a");
    await waitFor(() => expect(rooms.a.isConnected).toBe(true));

    act(() => rooms.a.disconnect());

    expect(rooms.a.isConnected).toBe(false);
    expect(rooms.a.isConnecting).toBe(false);
    expect(client.getConnection(channels.chat)).toBeUndefined();
  });

  it("subscribes again on reconnect() after a disconnect()", async () => {
    const { rooms, mount } = await setup();
    mount("a");
    await waitFor(() => expect(rooms.a.isConnected).toBe(true));
    act(() => rooms.a.disconnect());

    act(() => rooms.a.reconnect());

    await waitFor(() => expect(rooms.a.isConnected).toBe(true));
    await rooms.a.send({ text: "back" });
    await waitFor(() =>
      expect(received.map((it) => JSON.parse(it))).toContainEqual({
        roomId: "a",
        message: { text: "back" },
      }),
    );
  });

  it("leaves another hook's connection alone when it unmounts after a disconnect()", async () => {
    const { rooms, mount, client, channels } = await setup();
    const a = mount("a");
    await waitFor(() => expect(rooms.a.isConnected).toBe(true));
    act(() => rooms.a.disconnect());

    mount("b");
    await waitFor(() => expect(rooms.b.isConnected).toBe(true));
    const connection = client.getConnection(channels.chat);

    a.unmount();

    expect(client.getConnection(channels.chat)).toBe(connection);
    await expect(rooms.b.send({ text: "still here" })).resolves.toBeUndefined();
  });

  it("releases the connection on unmount", async () => {
    const { rooms, mount, client, channels } = await setup();
    const a = mount("a");
    await waitFor(() => expect(rooms.a.isConnected).toBe(true));

    a.unmount();

    expect(client.getConnection(channels.chat)).toBeUndefined();
  });
});
