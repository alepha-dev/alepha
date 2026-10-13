import { $atom, Alepha, AlephaError, z } from "alepha";
import { $actor, ActorCodec, type ActorEnvelope } from "alepha/actor";
import {
  ActorContentionError,
  AlephaActorRedis,
  RedisActorProvider,
  actorRedisOptions,
} from "alepha/actor/redis";

import { ActorContract } from "../../core/__tests__/ActorContract.ts";
import { ContractActors } from "../../core/__tests__/ContractActors.ts";

const count = $atom({ name: "redis-counter", schema: z.integer(), default: 0 });
const nested = $atom({
  name: "redis-session",
  schema: z.object({ names: z.array(z.text()) }),
  default: { names: [] },
});
class Actors {
  collisionA = $actor({
    atom: $atom({ name: "a:b", schema: z.integer(), default: 0 }),
    methods: { add: (state, amount: number) => state + amount },
  });
  collisionB = $actor({
    atom: $atom({ name: "a", schema: z.integer(), default: 0 }),
    methods: { add: (state, amount: number) => state + amount },
  });
  counter = $actor({
    atom: count,
    methods: {
      add: (state, amount: number = 1) => state + amount,
      fail: () => {
        throw new AlephaError("refused");
      },
      invalid: () => 0.5,
      asyncResult: () => Promise.resolve(1) as any,
    },
  });
  expiring = $actor({
    atom: $atom({ name: "redis-expiring", schema: z.integer(), default: 0 }),
    methods: { set: (_, value: number) => value },
    expiresAt: (state) => (state > 0 ? state : undefined),
  });
  session = $actor({
    atom: nested,
    methods: {
      append: (state, name: string) => ({ names: [...state.names, name] }),
    },
  });
}
class FaultProvider extends RedisActorProvider {
  mode = "normal";
  writes = 0;
  gets = 0;
  delays: number[] = [];
  protected override backoff(attempt: number): Promise<void> {
    const { baseDelayMs, maxDelayMs } = this.settings;
    this.delays.push(Math.min(maxDelayMs, baseDelayMs * 2 ** attempt));
    return super.backoff(attempt);
  }
  // The upper bound of every jitter window, so the delays are exact.
  protected override random(): number {
    return 0.999;
  }
  protected override load(identity: string): Promise<string | undefined> {
    this.gets++;
    return super.load(identity);
  }
  protected override async compareAndSet(
    identity: string,
    raw: string | undefined,
    next: ActorEnvelope,
  ): Promise<{ committed: boolean; current?: string }> {
    this.writes++;
    if (this.mode === "conflict") return { committed: false, current: raw };
    if (this.mode === "transport") throw new AlephaError("transport unknown");
    if (this.mode === "postcommit") {
      await super.compareAndSet(identity, raw, next);
      throw new AlephaError("transport unknown");
    }
    // Another replica writes (or deletes) the key between our GET and CAS once.
    if (this.mode === "race" || this.mode === "vanish") {
      const mode = this.mode;
      this.mode = "normal";
      if (mode === "race")
        await this.redis.set(
          identity,
          JSON.stringify({ version: 1, revision: 99, state: 1000 }),
        );
      else await this.redis.del([identity]);
    }
    return super.compareAndSet(identity, raw, next);
  }
  async corrupt(name: string, raw: string) {
    await this.redis.set(this.codec.identity(this.alepha.name, name), raw);
  }
  async expireTime(name: string) {
    return this.redis.eval(
      "return redis.call('PEXPIRETIME', KEYS[1])",
      [this.codec.identity(this.alepha.name, name)],
      [],
    );
  }
  async raw(name: string) {
    return (
      await this.redis.get(this.codec.identity(this.alepha.name, name))
    )?.toString("utf8");
  }
  async clean() {
    await this.redis.del(await this.redis.keys("*" + this.alepha.name + "*"));
  }
}

const attempts = (maxAttempts: number) => ({
  maxAttempts,
  baseDelayMs: 1,
  maxDelayMs: 50,
  expiryGraceMs: 60_000,
});

export class RedisActorContract {
  static async run(expect: (value: any) => any): Promise<void> {
    const namespace = "actor-test-" + crypto.randomUUID();
    const make = (suffix = "") =>
      Alepha.create({
        env: {
          APP_NAME: namespace + suffix,
          REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:16379",
        },
      })
        .with({ provide: RedisActorProvider, use: FaultProvider })
        .with(AlephaActorRedis);
    const containers = Array.from({ length: 4 }, () => make());
    containers.push(make(":contract"));
    try {
      const actors = containers.map((container) => container.inject(Actors));
      const contractActors = containers.map((container) =>
        container.inject(ContractActors),
      );
      await Promise.all(containers.map((container) => container.start()));
      let contractIndex = 0;
      await ActorContract.run({
        call: (name, method, args = [], key, other) => {
          let actor =
            contractActors[other ? 4 : contractIndex++ % 4].byName(name);
          if (key !== undefined) actor = actor.get(key);
          return method === undefined ? actor.read() : actor[method](...args);
        },
        local: async (value) => {
          if (value !== undefined)
            containers[0].store.set(ContractActors.counterAtom, value);
          return containers[0].store.get(ContractActors.counterAtom);
        },
        put: (raw) =>
          containers[0].inject(FaultProvider).corrupt("contract.corrupt", raw),
        raw: () => containers[0].inject(FaultProvider).raw("contract.corrupt"),
      });
      expect(
        await Promise.all(
          actors.slice(0, 4).map((actor) => actor.counter.read()),
        ),
      ).toEqual([0, 0, 0, 0]);
      const updates = await Promise.all(
        actors
          .slice(0, 4)
          .flatMap((actor) =>
            Array.from({ length: 10 }, () => actor.counter.add()),
          ),
      );
      expect(updates.slice().sort((a, b) => a - b)).toEqual(
        Array.from({ length: 40 }, (_, i) => i + 1),
      );
      expect(await actors[0].counter.read()).toBe(40);
      expect(await actors[0].collisionA.get("c").add(7)).toBe(7);
      expect(await actors[1].collisionB.get("b:c").read()).toBe(0);
      expect(await actors[4].counter.read()).toBe(0);
      expect(await actors[0].counter.get("default").add(3)).toBe(3);
      expect(await actors[1].counter.get("default").read()).toBe(3);
      expect(await actors[0].counter.read()).toBe(40);
      const snapshot = await actors[0].session.append("original");
      snapshot.names.push("mutated");
      expect(await actors[1].session.read()).toEqual({ names: ["original"] });
      for (const action of [
        () => actors[0].counter.fail(),
        () => actors[0].counter.invalid(),
        () => actors[0].counter.asyncResult(),
        () => actors[0].counter.add(undefined),
      ])
        await expect(action()).rejects.toThrow();
      expect(await actors[1].counter.read()).toBe(40);
      const fault = containers[0].inject(FaultProvider);
      expect(() =>
        containers[0].store.set(actorRedisOptions, attempts(0)),
      ).toThrow();
      expect(() =>
        containers[0].store.set(actorRedisOptions, {
          ...attempts(2),
          baseDelayMs: -1,
        }),
      ).toThrow();
      // Conflicts back off exponentially, capped, with no wait after the last.
      containers[0].store.set(actorRedisOptions, attempts(8));
      fault.mode = "conflict";
      fault.writes = 0;
      fault.delays = [];
      await expect(actors[0].counter.add()).rejects.toBeInstanceOf(
        ActorContentionError,
      );
      expect(fault.writes).toBe(8);
      expect(fault.delays).toEqual([1, 2, 4, 8, 16, 32, 50]);
      // A first mutation on a missing key is one GET and one CAS.
      fault.mode = "normal";
      fault.writes = 0;
      fault.gets = 0;
      expect(await actors[0].counter.get("fresh").add(2)).toBe(2);
      expect([fault.gets, fault.writes]).toEqual([1, 1]);
      // A conflict returns the current value: the retry is one more CAS, no GET.
      containers[0].store.set(actorRedisOptions, attempts(32));
      fault.mode = "race";
      fault.writes = 0;
      fault.gets = 0;
      expect(await actors[0].counter.get("fresh").add(1)).toBe(1001);
      expect([fault.gets, fault.writes]).toEqual([1, 2]);
      // A conflict on a key deleted meanwhile retries it as missing.
      fault.mode = "vanish";
      fault.writes = 0;
      fault.gets = 0;
      expect(await actors[0].counter.get("fresh").add(1)).toBe(1);
      expect([fault.gets, fault.writes]).toEqual([1, 2]);
      containers[0].store.set(actorRedisOptions, attempts(2));
      fault.mode = "normal";
      fault.writes = 0;
      // An expiring envelope sets PXAT at expiresAt + grace; v1 clears it.
      const until = 4_000_000_000_000;
      expect(await actors[0].expiring.set(until)).toBe(until);
      expect(await fault.expireTime("redis-expiring")).toBe(until + 60_000);
      expect(await actors[0].expiring.set(-1)).toBe(-1);
      expect(await fault.expireTime("redis-expiring")).toBe(-1);
      fault.writes = 0;
      // A no-op transition issues no compare-and-set at all.
      expect(await actors[0].counter.add(0)).toBe(40);
      expect(fault.writes).toBe(0);
      // A transport error is never retried, so it never waits.
      fault.mode = "transport";
      fault.writes = 0;
      fault.delays = [];
      await expect(actors[0].counter.add()).rejects.toThrow(
        "transport unknown",
      );
      expect(fault.writes).toBe(1);
      expect(fault.delays).toEqual([]);
      fault.mode = "postcommit";
      fault.writes = 0;
      await expect(actors[0].counter.add()).rejects.toThrow(
        "transport unknown",
      );
      expect(fault.writes).toBe(1);
      expect(await actors[1].counter.read()).toBe(41);
      fault.mode = "normal";
      for (const raw of [
        "{",
        '{"version":2,"revision":0,"state":0}',
        '{"version":1,"revision":0,"state":0.5}',
        '{"version":1,"revision":9007199254740991,"state":0}',
      ]) {
        await fault.corrupt("redis-counter", raw);
        await expect(actors[0].counter.add()).rejects.toThrow();
        expect(await fault.raw("redis-counter")).toBe(raw);
      }
      const codec = containers[0].inject(ActorCodec);
      expect(codec.identity(namespace, "a:b", "c")).not.toBe(
        codec.identity(namespace, "a", "b:c"),
      );
      // alepha.name is never empty, so selecting Redis needs no variable.
      expect(() => Alepha.create().with(AlephaActorRedis)).not.toThrow();
      const memory = Alepha.create({ env: { REDIS_URL: "redis://invalid:1" } });
      memory.inject(Actors);
      // REDIS_URL must not select a Redis provider or open a connection.
      expect(await memory.inject(Actors).counter.add()).toBe(1);
    } finally {
      await Promise.all(
        containers.map(async (container) => {
          await container.inject(FaultProvider).clean();
          await container.stop();
        }),
      );
    }
  }
}
