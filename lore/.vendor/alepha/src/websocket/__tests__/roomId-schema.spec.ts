import { Alepha, z } from "alepha";
import { NodeHttpServerProvider } from "alepha/server";
import { describe, it } from "vitest";
import WebSocket from "ws";

import { AlephaWebSocket } from "../index.ts";
import { $channel } from "../primitives/$channel.ts";
import { $room } from "../primitives/$room.ts";
import { $websocket } from "../primitives/$websocket.ts";

/**
 * `$channel({ schema: { roomId } })` was documented on the primitive and in
 * the guide, and nothing read it: a channel could declare `z.uuid()` and the
 * server took whatever string a client asked for.
 *
 * The Cloudflare half of the same rule lives in
 * `WebSocketRoom.connection-limit.spec.ts`.
 */
const waitForOpen = (ws: WebSocket) =>
  new Promise<void>((resolve) => ws.on("open", resolve));

const waitForClose = (ws: WebSocket) =>
  new Promise<{ code: number; reason: string }>((resolve) =>
    ws.on("close", (code, reason) =>
      resolve({ code, reason: reason.toString() }),
    ),
  );

const messageSchemas = {
  in: z.object({ type: z.text() }),
  out: z.object({ type: z.text() }),
};

const boot = async () => {
  class Controller {
    strict = $channel({
      path: "/ws/strict",
      schema: { roomId: z.uuid(), ...messageSchemas },
    });

    strictSocket = $websocket({
      channel: this.strict,
      handler: async () => {},
    });

    strictRoomChannel = $channel({
      path: "/ws/strict-room",
      schema: { roomId: z.uuid(), ...messageSchemas },
    });

    strictRoom = $room<any, any, { tick: number }>({
      channel: this.strictRoomChannel,
      state: () => ({ tick: 0 }),
    });

    loose = $channel({ path: "/ws/loose", schema: messageSchemas });

    looseSocket = $websocket({
      channel: this.loose,
      handler: async () => {},
    });
  }

  const alepha = Alepha.create().with(AlephaWebSocket);
  alepha.inject(Controller);
  await alepha.start();

  const hostname = alepha
    .inject(NodeHttpServerProvider)
    .hostname.replace("http://", "ws://");

  return {
    alepha,
    connect: (path: string, query = "") =>
      new WebSocket(`${hostname}${path}${query}`),
  };
};

const UUID = "9f1c2c62-6a3f-4a26-9a4e-2f0a1d7c9b11";

describe("$channel schema.roomId", () => {
  it("closes a $websocket join whose room id fails the schema", async ({
    expect,
  }) => {
    const { alepha, connect } = await boot();

    const ws = connect("/ws/strict", "?roomId=not-a-uuid");
    const { code, reason } = await waitForClose(ws);

    expect(code).toBe(1008);
    expect(reason).toBe("Invalid room id");
    await alepha.stop();
  });

  it("closes a $room join whose room id fails the schema", async ({
    expect,
  }) => {
    const { alepha, connect } = await boot();

    const ws = connect("/ws/strict-room", "?roomId=nope");
    const { code } = await waitForClose(ws);

    expect(code).toBe(1008);
    await alepha.stop();
  });

  it("checks every room id of a multi-room join, not just the first", async ({
    expect,
  }) => {
    const { alepha, connect } = await boot();

    const ws = connect("/ws/strict", `?roomIds=${UUID},not-a-uuid`);
    const { code } = await waitForClose(ws);

    expect(code).toBe(1008);
    await alepha.stop();
  });

  it("admits a room id the schema accepts", async ({ expect }) => {
    const { alepha, connect } = await boot();

    const ws = connect("/ws/strict", `?roomId=${UUID}`);
    await waitForOpen(ws);

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    await alepha.stop();
  });

  // No `roomId` in the query means the framework's own `default`, not
  // something the client chose. A channel declaring `z.uuid()` would
  // otherwise refuse every connection that simply omitted the parameter.
  it("admits a join that names no room at all", async ({ expect }) => {
    const { alepha, connect } = await boot();

    const ws = connect("/ws/strict");
    await waitForOpen(ws);

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    await alepha.stop();
  });

  it("admits anything on a channel that declares no roomId schema", async ({
    expect,
  }) => {
    const { alepha, connect } = await boot();

    const ws = connect("/ws/loose", "?roomId=anything-at-all");
    await waitForOpen(ws);

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    await alepha.stop();
  });
});
