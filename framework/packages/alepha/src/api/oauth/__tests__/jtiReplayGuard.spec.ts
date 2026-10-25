import { describe, expect, it } from "vitest";

import { JtiReplayGuard } from "../helpers/jtiReplayGuard.ts";

describe("JtiReplayGuard", () => {
  it("accepts a jti once, rejects the replay", () => {
    const g = new JtiReplayGuard();
    const now = 1_000;
    expect(g.check("a", now)).toBe(true);
    expect(g.check("a", now)).toBe(false);
    expect(g.check("b", now)).toBe(true);
  });

  it("accepts the same jti again once its TTL has elapsed", () => {
    const g = new JtiReplayGuard(100); // 100ms TTL
    expect(g.check("a", 1_000)).toBe(true);
    expect(g.check("a", 1_050)).toBe(false); // still within TTL
    expect(g.check("a", 2_000)).toBe(true); // expired → fresh again
  });

  it("stays bounded under churn (hard cap evicts oldest)", () => {
    const g = new JtiReplayGuard(60_000, 5) as unknown as {
      check: (j: string, n?: number) => boolean;
      seen: Map<string, number>;
    };
    for (let i = 0; i < 50; i++) g.check(`j${i}`, 1_000);
    expect(g.seen.size).toBeLessThanOrEqual(5);
  });

  it("reports a used jti without spending an unused one", () => {
    const g = new JtiReplayGuard();

    // `wasUsed` is the read a caller does before it has finished validating:
    // asking must not consume, or a request that fails a LATER check would
    // burn a token it never got to use.
    expect(g.wasUsed("a", 1_000)).toBe(false);
    expect(g.wasUsed("a", 1_000)).toBe(false);
    expect(g.check("a", 1_000)).toBe(true);
    expect(g.wasUsed("a", 1_000)).toBe(true);
  });
});
