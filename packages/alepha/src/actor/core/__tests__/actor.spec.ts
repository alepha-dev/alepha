import { $atom, Alepha, AlephaError, z } from "alepha";
import {
  $actor,
  ActorCodec,
  ActorRegistry,
  MemoryActorProvider,
} from "alepha/actor";
import { DateTimeProvider } from "alepha/datetime";
import { describe, it, expect } from "vitest";

const counter = $atom({ name: "counter", schema: z.integer(), default: 0 });
class Counters {
  value = $actor({
    atom: counter,
    methods: {
      add: (state, amount: number = 1) => state + amount,
      fail: () => {
        throw new AlephaError("refused");
      },
      invalid: () => 1.5,
      // Deliberately test rejection of user-supplied thenable state.
      // oxlint-disable-next-line unicorn/no-thenable
      thenable: () => ({ then: () => {} }) as any,
    },
  });
}
const nested = $atom({
  name: "session",
  schema: z.object({ items: z.array(z.object({ name: z.text() })) }),
  default: { items: [] },
});
class Sessions {
  value = $actor({
    atom: nested,
    methods: {
      append: (state, item: { name: string }) => ({
        items: [...state.items, item],
      }),
      mutate: (state) => {
        (state.items as any[]).push({ name: "bad" });
        throw new AlephaError("refused");
      },
    },
  });
}
const windowed = $atom({
  name: "windowed",
  schema: z.object({ count: z.integer(), resetAt: z.integer() }),
  default: { count: 0, resetAt: 0 },
});
class Windows {
  value = $actor({
    atom: windowed,
    methods: {
      hit: (state, now: number, windowMs: number) =>
        state.resetAt <= now
          ? { count: 1, resetAt: now + windowMs }
          : { count: state.count + 1, resetAt: state.resetAt },
      broken: (state) => ({ count: -1, resetAt: state.resetAt }),
    },
    expiresAt: (state) => (state.count < 0 ? 1.5 : state.resetAt),
  });
}
class InspectMemory extends MemoryActorProvider {
  put(identity: string, raw: string) {
    this.snapshots.set(identity, raw);
  }
  raw(identity: string) {
    return this.snapshots.get(identity);
  }
}

describe("actor Memory contract", () => {
  it("returns each committed snapshot and isolates containers and default/keyed handles", async () => {
    const a = Alepha.create().inject(Counters).value;
    const b = Alepha.create().inject(Counters).value;
    expect(
      await Promise.all(Array.from({ length: 50 }, () => a.add())),
    ).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(await a.read()).toBe(50);
    expect(await b.read()).toBe(0);
    expect(await a.get("default").add(2)).toBe(2);
    expect(await a.read()).toBe(50);
    expect(() => a.get("")).toThrow();
    const keyed: Promise<number> = a.get("typed").add(3);
    await keyed;
    const typedActor = a.get("typed");
    // @ts-expect-error keyed reducer argument remains typed
    void typedActor.add("bad").catch(() => {});
    // @ts-expect-error reducer argument remains typed
    void a.add("bad").catch(() => {});
  });

  it("detaches captured arguments, readonly state, returned snapshots and defaults", async () => {
    const service = Alepha.create().inject(Sessions);
    const item = { name: "original" };
    const pending = service.value.append(item);
    item.name = "changed";
    const result = await pending;
    expect(result).toEqual({ items: [{ name: "original" }] });
    result.items[0].name = "mutated result";
    expect(await service.value.read()).toEqual({
      items: [{ name: "original" }],
    });
    await expect(service.value.mutate()).rejects.toThrow();
    expect(await service.value.append({ name: "next" })).toEqual({
      items: [{ name: "original" }, { name: "next" }],
    });
    expect(nested.options.default).toEqual({ items: [] });
  });

  it("preserves state and recovers queues after reducer, schema and async-result failures", async () => {
    const actor = Alepha.create().inject(Counters).value;
    await expect(actor.fail()).rejects.toThrow("refused");
    // A failed first call stores nothing: the key still reads the default.
    counter.options.default = 100;
    expect(await actor.read()).toBe(100);
    counter.options.default = 0;
    await actor.add(4);
    await expect(actor.fail()).rejects.toThrow("refused");
    await expect(actor.invalid()).rejects.toThrow();
    await expect(actor.thenable()).rejects.toThrow();
    await expect(actor.add(undefined)).rejects.toThrow();
    expect(await actor.add()).toBe(5);
  });

  it("rejects duplicate declarations, reserved methods and async reducers", () => {
    class Duplicate {
      one = $actor({ atom: counter, methods: {} });
      two = $actor({ atom: counter, methods: {} });
    }
    class Reserved {
      value = $actor({ atom: counter, methods: { read: (value) => value } });
    }
    class AsyncReducer {
      value = $actor({
        atom: counter,
        methods: { add: (async (value: number) => value + 1) as any },
      });
    }
    expect(() => Alepha.create().inject(Duplicate)).toThrow("Duplicate");
    expect(() => Alepha.create().inject(Reserved)).toThrow("Reserved");
    expect(() => Alepha.create().inject(AsyncReducer)).toThrow("synchronous");
    const alepha = Alepha.create();
    alepha.inject(Counters);
    expect(() => alepha.inject(ActorRegistry).get("missing")).toThrow(
      "Unknown",
    );
  });

  it("does not read or write the ordinary local atom store", async () => {
    const alepha = Alepha.create();
    const actor = alepha.inject(Counters).value;
    alepha.store.set(counter, 100);
    expect(await actor.add()).toBe(1);
    expect(alepha.store.get(counter)).toBe(100);
  });

  it("fails closed for corrupt envelopes and stored schema changes", async () => {
    const alepha = Alepha.create().with({
      provide: MemoryActorProvider,
      use: InspectMemory,
    });
    const actor = alepha.inject(Counters).value;
    const provider = alepha.inject(InspectMemory);
    const codec = alepha.inject(ActorCodec);
    const identity = codec.identity(alepha.name, "counter");
    for (const raw of [
      "{",
      '{"version":2,"revision":0,"state":0}',
      '{"version":1,"revision":0,"state":0.1}',
      '{"version":1,"revision":9007199254740991,"state":0}',
    ]) {
      provider.put(identity, raw);
      await expect(actor.add()).rejects.toThrow();
    }
  });

  it("rejects unsupported defaults and async schemas without writing", async () => {
    const optional = $atom({ name: "optional", schema: z.text().optional() });
    class UndefinedDefault {
      value = $actor({ atom: optional, methods: {} });
    }
    await expect(
      Alepha.create().inject(UndefinedDefault).value.read(),
    ).rejects.toThrow();
    const asyncAtom = $atom({
      name: "async",
      schema: z.integer().refine(async () => true),
      default: 0,
    });
    class AsyncSchema {
      value = $actor({ atom: asyncAtom, methods: {} });
    }
    await expect(
      Alepha.create().inject(AsyncSchema).value.read(),
    ).rejects.toThrow();
  });

  it("expires state derived from the state once the clock reaches it", async () => {
    const alepha = Alepha.create().with({
      provide: MemoryActorProvider,
      use: InspectMemory,
    });
    const actor = alepha.inject(Windows).value;
    const memory = alepha.inject(InspectMemory);
    const identity = alepha
      .inject(ActorCodec)
      .identity(alepha.name, "windowed");
    const dateTime = alepha.inject(DateTimeProvider);
    dateTime.pause();
    const start = dateTime.nowMillis();
    expect(await actor.hit(start, 1000)).toEqual({
      count: 1,
      resetAt: start + 1000,
    });
    expect(await actor.hit(start, 1000)).toEqual({
      count: 2,
      resetAt: start + 1000,
    });
    expect(JSON.parse(memory.raw(identity)!)).toEqual({
      version: 2,
      revision: 2,
      state: { count: 2, resetAt: start + 1000 },
      expiresAt: start + 1000,
    });
    await dateTime.travel(999);
    expect(await actor.read()).toEqual({ count: 2, resetAt: start + 1000 });
    await dateTime.travel(1);
    // At expiresAt the state reads as missing; the read leaves it stored.
    expect(await actor.read()).toEqual({ count: 0, resetAt: 0 });
    expect(memory.raw(identity)).toBeDefined();
    const now = dateTime.nowMillis();
    await actor.hit(now, 1000);
    expect(JSON.parse(memory.raw(identity)!).revision).toBe(1);
    // An expiry that is not a safe integer fails the transition, state kept.
    await expect(actor.broken()).rejects.toThrow("safe integer");
    expect(await actor.read()).toEqual({ count: 1, resetAt: now + 1000 });
  });

  it("refuses an asynchronous or non-function expiresAt at declaration", () => {
    class AsyncExpiry {
      value = $actor({
        atom: counter,
        methods: {},
        expiresAt: (async () => 1) as any,
      });
    }
    class NotFunction {
      value = $actor({ atom: counter, methods: {}, expiresAt: 5 as any });
    }
    expect(() => Alepha.create().inject(AsyncExpiry)).toThrow("expiresAt");
    expect(() => Alepha.create().inject(NotFunction)).toThrow("expiresAt");
  });

  it("uses lossless JSON and injective versioned identities", () => {
    const codec = Alepha.create().inject(ActorCodec);
    const cycle: any = {};
    cycle.self = cycle;
    const sparse: unknown[] = [];
    sparse.length = 2;
    const hidden = Object.defineProperty({}, "hidden", { value: 1 });
    for (const value of [
      undefined,
      NaN,
      Infinity,
      -0,
      1n,
      new Date(),
      new Map(),
      new Set(),
      () => {},
      cycle,
      sparse,
      { a: undefined },
      hidden,
      {
        get value() {
          return 1;
        },
      },
      { [Symbol()]: 1 },
    ])
      expect(() => codec.copy(value)).toThrow();
    expect(codec.copy({ a: [null, true, 1, "text"] })).toEqual({
      a: [null, true, 1, "text"],
    });
    expect(codec.identity("a:b", "c")).not.toBe(codec.identity("a", "b:c"));
    expect(codec.identity("", "counter")).not.toBe(
      codec.identity("", "counter", "default"),
    );
  });
});
