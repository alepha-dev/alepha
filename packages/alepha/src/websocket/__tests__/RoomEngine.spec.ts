import { describe, expect, it } from "vitest";
import type {
  RoomClock,
  RoomPrimitiveOptions,
  RoomSocket,
} from "../interfaces/RoomInterfaces.ts";
import { RoomEngine, type RoomEngineDeps } from "../providers/RoomEngine.ts";

/**
 * Deterministic clock: intervals fire once each time virtual time is advanced
 * by their period. Good enough for these tests, where every `advance(ms)`
 * matches the interval period.
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

  get liveTimers(): number {
    return this.handlers.size;
  }

  /** Advance virtual time by `ms` and fire every live interval once. */
  advance(ms: number): void {
    this.ms += ms;
    for (const fn of [...this.handlers.values()]) fn();
  }
}

let socketSeq = 0;
function fakeSocket(userId?: string): RoomSocket & {
  sent: string[];
  closed?: { code?: number; reason?: string };
} {
  const sent: string[] = [];
  const socket = {
    id: `c${++socketSeq}`,
    userId,
    data: {} as Record<string, unknown>,
    sent,
    closed: undefined as { code?: number; reason?: string } | undefined,
    sendRaw: (d: string) => sent.push(d),
    close: (code?: number, reason?: string) => {
      socket.closed = { code, reason };
    },
  };
  return socket;
}

function fakeChannel() {
  return { options: { path: "/ws/test", schema: {} } } as any;
}

function makeEngine<TState>(
  options: Partial<RoomPrimitiveOptions<any, any, TState>>,
  deps: Partial<RoomEngineDeps<any, any, TState>> = {},
) {
  return new RoomEngine<any, any, TState>({
    roomId: "r1",
    clock: deps.clock ?? new FakeClock(),
    validate: deps.validate,
    log: deps.log,
    options: { channel: fakeChannel(), ...options },
  });
}

describe("RoomEngine — tick loop", () => {
  it("ticks at tickHz once a socket has joined, passing elapsed dt", async () => {
    const clock = new FakeClock();
    const dts: number[] = [];
    const engine = makeEngine(
      {
        tickHz: 20,
        onTick: (_room, dt) => {
          dts.push(dt);
        },
      },
      { clock },
    );

    await engine.join(fakeSocket());
    clock.advance(50);
    clock.advance(50);

    expect(dts).toEqual([50, 50]);
  });

  it("does not tick before the first socket joins", async () => {
    const clock = new FakeClock();
    let ticks = 0;
    makeEngine({ tickHz: 20, onTick: () => { ticks++; } }, { clock });

    clock.advance(50);
    clock.advance(50);

    expect(ticks).toBe(0);
    expect(clock.liveTimers).toBe(0);
  });

  it("stops ticking and clears the timer after the last socket leaves", async () => {
    const clock = new FakeClock();
    let ticks = 0;
    const engine = makeEngine({ tickHz: 20, onTick: () => { ticks++; } }, { clock });
    const socket = fakeSocket();

    await engine.join(socket);
    clock.advance(50);
    await engine.leave(socket.id);
    clock.advance(50);

    expect(ticks).toBe(1);
    expect(clock.liveTimers).toBe(0);
  });

  it("restarts the loop when a socket rejoins an emptied room", async () => {
    const clock = new FakeClock();
    let ticks = 0;
    const engine = makeEngine({ tickHz: 20, onTick: () => { ticks++; } }, { clock });
    const a = fakeSocket();

    await engine.join(a);
    clock.advance(50);
    await engine.leave(a.id);
    clock.advance(50); // no timer — no tick
    await engine.join(fakeSocket());
    clock.advance(50);

    expect(ticks).toBe(2);
  });

  it("never lets an onTick throw escape the loop", async () => {
    const clock = new FakeClock();
    const errors: string[] = [];
    const engine = makeEngine(
      {
        tickHz: 20,
        onTick: () => {
          throw new Error("boom");
        },
      },
      { clock, log: (level, msg) => level === "error" && errors.push(msg) },
    );

    await engine.join(fakeSocket());
    expect(() => clock.advance(50)).not.toThrow();
    expect(errors.length).toBe(1);
  });
});

describe("RoomEngine — state lifecycle", () => {
  it("builds state once via the factory and exposes it to onTick", async () => {
    const clock = new FakeClock();
    let built = 0;
    const seen: number[] = [];
    const engine = makeEngine<{ n: number }>(
      {
        tickHz: 20,
        state: () => {
          built++;
          return { n: 42 };
        },
        onTick: (room) => { seen.push(room.state.n); },
      },
      { clock },
    );

    await engine.join(fakeSocket());
    await engine.join(fakeSocket());
    clock.advance(50);

    expect(built).toBe(1);
    expect(seen).toEqual([42]);
  });

  it("runs onEmpty then discards state when the room empties", async () => {
    let emptied = 0;
    const engine = makeEngine<{ n: number }>({
      state: () => ({ n: 1 }),
      tickHz: 20,
      onEmpty: () => {
        emptied++;
      },
    });
    const socket = fakeSocket();

    await engine.join(socket);
    await engine.leave(socket.id);

    expect(emptied).toBe(1);
    // A fresh join rebuilds state via the factory again.
    let built = 0;
    const engine2 = makeEngine<{ n: number }>({
      state: () => {
        built++;
        return { n: 1 };
      },
    });
    await engine2.join(fakeSocket());
    await engine2.leave((engine2 as any).sockets.keys().next().value ?? "x");
    await engine2.join(fakeSocket());
    expect(built).toBe(2);
  });
});

describe("RoomEngine — lifecycle callbacks", () => {
  it("passes the joining/leaving connection to onJoin/onLeave", async () => {
    const joined: string[] = [];
    const left: string[] = [];
    const engine = makeEngine({
      onJoin: (_room, conn) => {
        joined.push(conn.id);
      },
      onLeave: (_room, conn) => {
        left.push(conn.id);
      },
    });
    const socket = fakeSocket("user-1");

    await engine.join(socket);
    await engine.leave(socket.id);

    expect(joined).toEqual([socket.id]);
    expect(left).toEqual([socket.id]);
  });

  it("keeps the per-connection data bag identity across callbacks", async () => {
    const engine = makeEngine({
      onJoin: (_room, conn) => {
        conn.data.heroId = "hero-9";
      },
      onTick: (room) => {
        for (const c of room.connections) c.data.ticked = true;
      },
      tickHz: 20,
    });
    const socket = fakeSocket();

    await engine.join(socket);

    expect(socket.data.heroId).toBe("hero-9");
  });
});

describe("RoomEngine — send / broadcast", () => {
  it("send targets only the named connection", async () => {
    const engine = makeEngine({
      onMessage: (room, conn) => {
        room.send(conn.id, { pong: true });
      },
    });
    const a = fakeSocket();
    const b = fakeSocket();
    await engine.join(a);
    await engine.join(b);

    await engine.message(a.id, { ping: true });

    expect(a.sent).toEqual([JSON.stringify({ pong: true })]);
    expect(b.sent).toEqual([]);
  });

  it("broadcast reaches everyone except the excepted ids", async () => {
    const engine = makeEngine({
      onMessage: (room, conn) => {
        room.broadcast({ hi: 1 }, { exceptConnectionIds: [conn.id] });
      },
    });
    const a = fakeSocket();
    const b = fakeSocket();
    const c = fakeSocket();
    await engine.join(a);
    await engine.join(b);
    await engine.join(c);

    await engine.message(a.id, {});

    expect(a.sent).toEqual([]);
    expect(b.sent).toEqual([JSON.stringify({ hi: 1 })]);
    expect(c.sent).toEqual([JSON.stringify({ hi: 1 })]);
  });

  it("close forwards code/reason to the named connection", async () => {
    const engine = makeEngine({
      onMessage: (room, conn) => {
        room.close(conn.id, 4000, "bye");
      },
    });
    const a = fakeSocket();
    await engine.join(a);

    await engine.message(a.id, {});

    expect(a.closed).toEqual({ code: 4000, reason: "bye" });
  });
});

describe("RoomEngine — message validation", () => {
  it("drops an invalid message, does not call onMessage, and reports an error", async () => {
    let handled = 0;
    const engine = makeEngine(
      { onMessage: () => { handled++; } },
      {
        validate: () => {
          throw new Error("bad shape");
        },
      },
    );
    const a = fakeSocket();
    await engine.join(a);

    await engine.message(a.id, { junk: true });

    expect(handled).toBe(0);
    expect(a.sent).toEqual([JSON.stringify({ error: "bad shape" })]);
  });

  it("delivers a valid message to onMessage", async () => {
    const got: unknown[] = [];
    const engine = makeEngine(
      { onMessage: (_room, _conn, msg) => { got.push(msg); } },
      { validate: () => {} },
    );
    const a = fakeSocket();
    await engine.join(a);

    await engine.message(a.id, { t: "move", dir: "left" });

    expect(got).toEqual([{ t: "move", dir: "left" }]);
  });

  it("keeps the room alive when onMessage throws", async () => {
    const engine = makeEngine({
      onMessage: () => {
        throw new Error("handler boom");
      },
    });
    const a = fakeSocket();
    await engine.join(a);

    await engine.message(a.id, {});

    expect(a.sent).toEqual([JSON.stringify({ error: "handler boom" })]);
    expect(engine.size).toBe(1);
  });
});

describe("RoomEngine — server-initiated push", () => {
  it("broadcast() from the server reaches every connected socket", async () => {
    const engine = makeEngine({});
    const a = fakeSocket();
    const b = fakeSocket();
    await engine.join(a);
    await engine.join(b);

    engine.broadcast({ tick: 1 });

    expect(a.sent).toEqual([JSON.stringify({ tick: 1 })]);
    expect(b.sent).toEqual([JSON.stringify({ tick: 1 })]);
  });

  it("send() from the server targets one socket", async () => {
    const engine = makeEngine({});
    const a = fakeSocket();
    const b = fakeSocket();
    await engine.join(a);
    await engine.join(b);

    engine.send(b.id, { hello: "b" });

    expect(a.sent).toEqual([]);
    expect(b.sent).toEqual([JSON.stringify({ hello: "b" })]);
  });
});

describe("RoomEngine — dispose", () => {
  it("stops the loop timer without waiting for the room to empty", async () => {
    const clock = new FakeClock();
    const engine = makeEngine({ tickHz: 20, onTick: () => {} }, { clock });
    await engine.join(fakeSocket());
    expect(clock.liveTimers).toBe(1);

    engine.dispose();

    expect(clock.liveTimers).toBe(0);
  });
});

describe("RoomEngine — headless coordinator methods", () => {
  it("invokes a named method and returns its result, building state lazily", async () => {
    let built = 0;
    const engine = makeEngine<{ switches: Record<string, boolean> }>({
      // no tickHz — headless
      state: () => {
        built++;
        return { switches: {} };
      },
      methods: {
        setSwitch: (room, id: string, value: boolean) => {
          room.state.switches[id] = value;
          return Object.keys(room.state.switches).length;
        },
        getSwitch: (room, id: string) => room.state.switches[id] ?? false,
      },
    });

    const count = await engine.call("setSwitch", ["door", true]);
    const value = await engine.call("getSwitch", ["door"]);

    expect(built).toBe(1);
    expect(count).toBe(1);
    expect(value).toBe(true);
  });

  it("throws for an unknown method", async () => {
    const engine = makeEngine({ methods: {} });
    await expect(engine.call("nope")).rejects.toThrow(/not defined/);
  });
});
