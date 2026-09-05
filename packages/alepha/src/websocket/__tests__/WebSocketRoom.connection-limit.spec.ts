import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { AlephaWebSocket } from "../index.ts";
import { $channel } from "../primitives/$channel.ts";
import { $room } from "../primitives/$room.ts";
import { $websocket } from "../primitives/$websocket.ts";
import { WebSocketRoom } from "../providers/WebSocketRoom.ts";

/**
 * `maxConnectionsPerUser` used to be a Node-only option: the Durable Object
 * never counted anything, so the cap simply did not exist on workerd while
 * the guide said it did.
 *
 * The DO owns every socket in its room, hibernated ones included, so the
 * count is exact there - and that is also why the cap is PER ROOM on this
 * engine, which the guide now states.
 *
 * Both halves are covered: the counting on its own, and the upgrade path in
 * `fetch` that has to act on it. Reaching `fetch` at all needs the two
 * workerd-only lines stubbed - `WebSocketPair` is a Workers global and Node's
 * `Response` rejects a 101 status - which is what {@link TestWebSocketRoom}
 * does. Every other WebSocketRoom spec avoids `fetch` entirely, and that gap
 * is exactly where a limit could be counted and then not applied.
 */
class FakeWs {
  public closedWith?: { code: number; reason: string };
  constructor(protected attachment: unknown) {}
  serializeAttachment(a: unknown) {
    this.attachment = a;
  }
  deserializeAttachment() {
    return this.attachment;
  }
  send() {}
  close(code?: number, reason?: string) {
    this.closedWith = { code: code ?? 1000, reason: reason ?? "" };
  }
}

/**
 * Replaces the two workerd-only lines of `fetch` - `new WebSocketPair()` and
 * the 101 `Response`, which Node rejects outright - so the upgrade path
 * itself can be driven from a spec.
 */
class TestWebSocketRoom extends WebSocketRoom {
  public lastServer?: FakeWs;

  protected createSocketPair() {
    const server = new FakeWs(null);
    this.lastServer = server;
    return { client: new FakeWs(null), server };
  }

  protected upgradeResponse(): Response {
    return new Response(null, { status: 200 });
  }
}

const ROOM_PATH = "/ws/game";
const PLAIN_PATH = "/ws/chat";
const STRICT_PATH = "/ws/lobby";

const setup = async (sockets: FakeWs[]) => {
  class App {
    game = $channel({
      path: ROOM_PATH,
      schema: {
        in: z.object({ type: z.text() }),
        out: z.object({ type: z.text() }),
      },
    });

    room = $room<any, any, { tick: number }>({
      channel: this.game,
      maxConnectionsPerUser: 2,
      state: () => ({ tick: 0 }),
    });

    lobby = $channel({
      path: STRICT_PATH,
      schema: {
        roomId: z.uuid(),
        in: z.object({ type: z.text() }),
        out: z.object({ type: z.text() }),
      },
    });

    lobbyRoom = $room<any, any, { tick: number }>({
      channel: this.lobby,
      state: () => ({ tick: 0 }),
    });

    chat = $channel({
      path: PLAIN_PATH,
      schema: {
        in: z.object({ type: z.text() }),
        out: z.object({ type: z.text() }),
      },
    });

    socket = $websocket({
      channel: this.chat,
      maxConnectionsPerUser: 1,
      handler: async () => {},
    });
  }

  const alepha = Alepha.create({ env: { NODE_ENV: "test" } }).with(
    AlephaWebSocket,
  );
  alepha.inject(App);
  (globalThis as any).__alepha = alepha;

  const ctx = {
    acceptWebSocket: (ws: FakeWs) => sockets.push(ws),
    getWebSockets: () => sockets,
  };
  return new TestWebSocketRoom(ctx as any, {});
};

const upgrade = (
  room: TestWebSocketRoom,
  path: string,
  userId: string,
  roomId = "r",
) =>
  room.fetch(
    new Request(`https://do.internal${path}`, {
      headers: {
        "x-alepha-ws-channel": path,
        "x-alepha-ws-room": roomId,
        "x-alepha-ws-user": userId,
        "x-alepha-ws-conn": "c-new",
      },
    }),
  );

const over = (room: WebSocketRoom, path: string, userId?: string) =>
  (room as any).isOverConnectionLimit(path, userId) as Promise<boolean>;

const socketOf = (userId: string) =>
  new FakeWs({ connectionId: `c-${Math.random()}`, userId, roomId: "r" });

describe("WebSocketRoom per-user connection limit", () => {
  it("allows a user below the room's cap", async () => {
    const sockets = [socketOf("ada")];
    const room = await setup(sockets);

    expect(await over(room, ROOM_PATH, "ada")).toBe(false);
  });

  it("refuses a user already holding the cap", async () => {
    const sockets = [socketOf("ada"), socketOf("ada")];
    const room = await setup(sockets);

    expect(await over(room, ROOM_PATH, "ada")).toBe(true);
  });

  it("counts only that user's own sockets", async () => {
    const sockets = [socketOf("grace"), socketOf("grace"), socketOf("ada")];
    const room = await setup(sockets);

    expect(await over(room, ROOM_PATH, "ada")).toBe(false);
    expect(await over(room, ROOM_PATH, "grace")).toBe(true);
  });

  // An unauthenticated socket has nothing to count against, on either engine.
  it("never refuses an anonymous socket", async () => {
    const sockets = [new FakeWs({ connectionId: "a" }), new FakeWs(null)];
    const room = await setup(sockets);

    expect(await over(room, ROOM_PATH, undefined)).toBe(false);
  });

  it("reads the cap off a stateless $websocket too", async () => {
    const sockets = [socketOf("ada")];
    const room = await setup(sockets);

    // Cap of 1 on that channel, and the same user is under 2 on the room.
    expect(await over(room, PLAIN_PATH, "ada")).toBe(true);
    expect(await over(room, ROOM_PATH, "ada")).toBe(false);
  });

  // The counting is only half of it: the upgrade path has to act on it, and
  // that wiring lived in `fetch`, which no spec could reach until the two
  // workerd-only lines became seams.
  it("closes an over-cap upgrade with 1008, and leaves it unattached", async () => {
    const sockets = [socketOf("ada"), socketOf("ada")];
    const room = await setup(sockets);

    await upgrade(room, ROOM_PATH, "ada");

    expect(room.lastServer?.closedWith).toEqual({
      code: 1008,
      reason: "Max connections per user exceeded",
    });
    // No attachment, so `webSocketClose` will leave the refused socket alone.
    expect(room.lastServer?.deserializeAttachment()).toBeNull();
  });

  it("lets an upgrade under the cap through, attachment and all", async () => {
    const sockets = [socketOf("ada")];
    const room = await setup(sockets);

    await upgrade(room, ROOM_PATH, "ada");

    expect(room.lastServer?.closedWith).toBeUndefined();
    expect(room.lastServer?.deserializeAttachment()).toMatchObject({
      connectionId: "c-new",
      userId: "ada",
      roomId: "r",
    });
  });

  it("does not refuse on a channel that declares no cap", async () => {
    const sockets = [socketOf("ada"), socketOf("ada"), socketOf("ada")];
    const room = await setup(sockets);

    expect(await over(room, "/ws/unknown", "ada")).toBe(false);
  });
});

/**
 * `schema.roomId` was documented on `$channel` and shown in the guide, and
 * nothing read it. A channel could declare `z.uuid()` and take any string
 * a client asked for.
 */
describe("WebSocketRoom room id validation", () => {
  it("refuses a room id the channel schema rejects", async () => {
    const room = await setup([]);

    await upgrade(room, STRICT_PATH, "ada", "not-a-uuid");

    expect(room.lastServer?.closedWith).toEqual({
      code: 1008,
      reason: "Invalid room id",
    });
  });

  it("admits a room id the schema accepts", async () => {
    const room = await setup([]);

    await upgrade(
      room,
      STRICT_PATH,
      "ada",
      "9f1c2c62-6a3f-4a26-9a4e-2f0a1d7c9b11",
    );

    expect(room.lastServer?.closedWith).toBeUndefined();
  });

  // `default` is the framework's fallback for a client that named no room,
  // not something a client chose. Validating it would refuse every
  // connection that simply omitted the parameter.
  it("never validates the implicit default room", async () => {
    const room = await setup([]);

    await upgrade(room, STRICT_PATH, "ada", "default");

    expect(room.lastServer?.closedWith).toBeUndefined();
  });

  it("admits anything on a channel that declares no roomId schema", async () => {
    const room = await setup([]);

    await upgrade(room, ROOM_PATH, "ada", "whatever-you-like");

    expect(room.lastServer?.closedWith).toBeUndefined();
  });
});

/**
 * The worker entry decides the room (through the provider's `admit`, which
 * lets an endpoint's `authorize` hook name it) and forwards it on the
 * trusted `x-alepha-ws-room` header. The Durable Object must read that
 * header and nothing else: a `?roomId=` that survived into the attachment
 * would let a client into a room its credential never named.
 */
describe("WebSocketRoom trusts the worker's room header", () => {
  it("takes the room from the header, never from the URL's roomId", async () => {
    const room = await setup([]);

    await room.fetch(
      new Request(`https://do.internal${PLAIN_PATH}?roomId=forged`, {
        headers: {
          "x-alepha-ws-channel": PLAIN_PATH,
          "x-alepha-ws-room": "real",
          "x-alepha-ws-conn": "c-1",
        },
      }),
    );

    const attachment = room.lastServer?.deserializeAttachment() as {
      roomId?: string;
      userId?: string;
    };
    expect(attachment.roomId).toBe("real");
    expect(attachment.userId).toBeUndefined();
  });
});
