import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";
import { AlephaWebSocket } from "../index.ts";
import type { RoomClock } from "../interfaces/RoomInterfaces.ts";
import { $channel } from "../primitives/$channel.ts";
import { $room } from "../primitives/$room.ts";
import { WebSocketRoom } from "../providers/WebSocketRoom.ts";

/**
 * Deterministic clock; intervals fire once per `advance()`.
 */
class FakeClock implements RoomClock {
  protected ms = 0;
  protected handlers = new Map<number, () => void>();
  protected nextId = 1;
  setInterval(fn: () => void): unknown {
    const id = this.nextId++;
    this.handlers.set(id, fn);
    return id;
  }
  clearInterval(handle: unknown): void {
    this.handlers.delete(handle as number);
  }
  now(): number {
    return this.ms;
  }
  advance(ms: number): void {
    this.ms += ms;
    for (const fn of [...this.handlers.values()]) fn();
  }
}

/** Minimal hibernation socket + DO state fakes. */
class FakeWs {
  public sent: string[] = [];
  public closed = false;
  constructor(protected attachment: any) {}
  serializeAttachment(a: any) {
    this.attachment = a;
  }
  deserializeAttachment() {
    return this.attachment;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
}

function fakeCtx() {
  const sockets: FakeWs[] = [];
  const alarms: number[] = [];
  return {
    sockets,
    alarms,
    acceptWebSocket: (ws: FakeWs) => sockets.push(ws),
    getWebSockets: () => sockets,
    storage: {
      setAlarm: (t: number) => {
        alarms.push(t);
      },
    },
  };
}

/**
 * Build an Alepha app whose room is registered, publish it into the global the
 * WebSocketRoom reads (`__alepha`), and return a room bound to a fake DO ctx +
 * fake clock. Mirrors how the real Durable Object hosts the shared app graph.
 */
async function setup() {
  const events: string[] = [];
  const queries: Array<Readonly<Record<string, string>> | undefined> = [];

  class Game {
    world = $channel({
      path: "/ws/world",
      schema: {
        in: z.object({ type: z.text(), n: z.number() }),
        out: z.object({ move: z.text() }),
      },
    });

    room = $room<any, any, { tick: number; moves: string[] }>({
      channel: this.world,
      tickHz: 20,
      state: () => ({ tick: 0, moves: [] }),
      onJoin: (_room, conn) => {
        events.push(`join:${conn.id}`);
        queries.push(conn.query);
      },
      onMessage: (room, _conn, msg: { move: string }) => {
        room.state.moves.push(msg.move);
      },
      onTick: (room) => {
        room.state.tick++;
        room.broadcast({ type: "tick", n: room.state.tick });
      },
      onLeave: (_room, conn) => {
        events.push(`leave:${conn.id}`);
      },
      methods: {
        moveCount: (room) => room.state.moves.length,
      },
    });
  }

  const alepha = Alepha.create({ env: { NODE_ENV: "test" } }).with(
    AlephaWebSocket,
  );
  alepha.inject(Game);
  (globalThis as any).__alepha = alepha;

  const clock = new FakeClock();
  const ctx = fakeCtx();
  const room = new WebSocketRoom(ctx as any, {}, clock);
  return { room, ctx, clock, events, queries };
}

/**
 * Simulate a hibernation-socket admission the way `fetch` does after accepting
 * the pair — but without the Workers-only `WebSocketPair`/101-`Response` that
 * cannot run under Node/Vitest.
 */
async function join(
  room: WebSocketRoom,
  ctx: ReturnType<typeof fakeCtx>,
  roomId: string,
  connectionId: string,
  query?: Record<string, string>,
): Promise<FakeWs> {
  const ws = new FakeWs(null);
  const attachment = {
    connectionId,
    userId: undefined,
    roomId,
    channelPath: "/ws/world",
    query,
  };
  ctx.acceptWebSocket(ws);
  ws.serializeAttachment(attachment);
  await (room as any).onSocketOpen(ws, attachment);
  return ws;
}

describe("WebSocketRoom hosting a $room engine", () => {
  it("joins a socket, ticks, and broadcasts world state to it", async () => {
    const { room, ctx, clock, events } = await setup();

    const ws = await join(room, ctx, "lobby", "c1");

    clock.advance(50);
    clock.advance(50);

    expect(events).toContain("join:c1");
    expect(ws.sent).toEqual([
      JSON.stringify({ type: "tick", n: 1 }),
      JSON.stringify({ type: "tick", n: 2 }),
    ]);
  });

  /**
   * The Node provider has always exposed the upgrade URL's query parameters on
   * `conn.query`; the Cloudflare path must carry them through the hibernation
   * attachment or an application that identifies the joining entity by query
   * hint (e.g. `/ws/world?roomId=…&hero=…`) silently refuses every join on
   * workerd while working perfectly in dev.
   */
  it("exposes the upgrade query parameters on the joining socket", async () => {
    const { room, ctx, queries } = await setup();

    await join(room, ctx, "lobby", "c1", { hero: "h-42", roomId: "lobby" });

    expect(queries).toEqual([{ hero: "h-42", roomId: "lobby" }]);
  });

  it("routes a validated client message into onMessage", async () => {
    const { room, ctx } = await setup();
    const ws = await join(room, ctx, "lobby", "c1");

    await room.webSocketMessage(ws, JSON.stringify({ move: "left" }));

    // The move was recorded in room state, observable through a method call.
    const count = await room.callRoom("/ws/world", "lobby", "moveCount");
    expect(count).toBe(1);
  });

  it("stops the loop and runs onLeave when the socket closes", async () => {
    const { room, ctx, clock, events } = await setup();
    const ws = await join(room, ctx, "lobby", "c1");

    clock.advance(50);
    await room.webSocketClose(ws);
    const before = ws.sent.length;
    clock.advance(50); // no live timer — no further ticks

    expect(events).toContain("leave:c1");
    expect(ws.sent.length).toBe(before);
  });

  it("arms a watchdog alarm on the first room join", async () => {
    const { room, ctx, clock } = await setup();
    await join(room, ctx, "lobby", "c1");

    // scheduled once, ~10s out on the room's own clock
    expect(ctx.alarms).toEqual([clock.now() + 10_000]);
  });

  it("rehydrates sockets and restarts the loop after an isolate reset", async () => {
    const { room, ctx, clock } = await setup();
    const ws = await join(room, ctx, "lobby", "c1");
    clock.advance(50);
    expect(ws.sent.length).toBe(1);

    // Simulate an isolate reset: a brand-new room over the SAME hibernation
    // sockets, with fresh (empty) in-memory engine state.
    const clock2 = new FakeClock();
    const room2 = new WebSocketRoom(ctx as any, {}, clock2);

    clock2.advance(50); // engine is gone — nothing ticks
    const beforeAlarm = ws.sent.length;

    await room2.alarm(); // watchdog re-hydrates c1, restarting the loop
    expect(ctx.alarms.at(-1)).toBe(clock2.now() + 10_000); // re-armed at now=50

    clock2.advance(50);
    expect(ws.sent.length).toBe(beforeAlarm + 1); // ticks resumed to the socket
  });

  /**
   * The watchdog rebuilds a `RoomSocket` from the deserialized attachment, not
   * from the original `fetch` request, so the query hint an application relied
   * on to identify the joining entity (e.g. lindocara's `?hero=`) must survive
   * that round-trip too — otherwise a room that outlives one isolate reset
   * loses `conn.query` on every connection it rehydrates.
   */
  it("still exposes the upgrade query on a connection rehydrated after an isolate reset", async () => {
    const { room, ctx, queries } = await setup();
    await join(room, ctx, "lobby", "c1", { hero: "h-42", roomId: "lobby" });
    queries.length = 0; // only interested in the rehydrated join below

    // Simulate an isolate reset: a brand-new room over the SAME hibernation
    // sockets, whose attachment is all that survives.
    const room2 = new WebSocketRoom(ctx as any, {}, new FakeClock());
    await room2.alarm(); // watchdog re-hydrates c1, calling onJoin again

    expect(queries).toEqual([{ hero: "h-42", roomId: "lobby" }]);
  });
});
