import { randomUUID } from "node:crypto";

import { $atom, Alepha, z } from "alepha";
import { $actor } from "alepha/actor";
import { describe, expect, it } from "vitest";

import { RedisActorContract } from "./RedisActorContract.ts";
describe("Redis actor Node contract", () => {
  it("commits independent-container transitions and fails closed without uncertain replay", async () => {
    await RedisActorContract.run(expect);
  });
});

describe("Redis actors: one namespace per alepha.name", () => {
  class Counters {
    counter = $actor({
      atom: $atom({
        name: "namespace-counter",
        schema: z.integer(),
        default: 0,
      }),
      methods: { add: (state, amount: number) => state + amount },
    });
  }

  const boot = async (name: string) => {
    const alepha = Alepha.create({
      env: {
        APP_NAME: name,
        REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:16379",
      },
    }).with(Counters);
    await alepha.start();
    return alepha.inject(Counters).counter;
  };

  it("shares state within a name and never across two", async ({ expect }) => {
    const name = `a-${randomUUID()}`;
    const a = await boot(name);
    const sibling = await boot(name);
    const other = await boot(`b-${randomUUID()}`);

    await a.add(2);
    expect(await sibling.add(3)).toBe(5);

    expect(await other.read()).toBe(0);
  });
});
