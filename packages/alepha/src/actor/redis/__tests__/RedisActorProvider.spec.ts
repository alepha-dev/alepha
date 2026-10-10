import { describe, expect, it } from "vitest";

import { RedisActorContract } from "./shared.ts";
describe("Redis actor Node contract", () => {
  it("commits independent-container transitions and fails closed without uncertain replay", async () => {
    await RedisActorContract.run(expect);
  });
});
