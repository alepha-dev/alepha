import { describe, expect, it } from "bun:test";

import { RedisActorContract } from "./shared.ts";
describe("Redis actor Bun contract", () => {
  it("commits independent-container transitions and fails closed without uncertain replay", async () => {
    await RedisActorContract.run(expect);
  });
});
