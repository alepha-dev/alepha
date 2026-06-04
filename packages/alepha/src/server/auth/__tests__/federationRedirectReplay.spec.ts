import { describe, expect, it } from "vitest";
import { JtiReplayGuard } from "../helpers/jtiReplayGuard.ts";
import { safeRedirectPath } from "../helpers/safeRedirectPath.ts";

describe("safeRedirectPath", () => {
  it("keeps a simple absolute path", () => {
    expect(safeRedirectPath("/me")).toBe("/me");
    expect(safeRedirectPath("/admin/pages?x=1")).toBe("/admin/pages?x=1");
  });

  it("rejects protocol-relative, absolute, backslash, and empty → fallback", () => {
    expect(safeRedirectPath("//evil.com")).toBe("/");
    expect(safeRedirectPath("https://evil.com")).toBe("/");
    expect(safeRedirectPath("/\\evil.com")).toBe("/");
    expect(safeRedirectPath("evil")).toBe("/");
    expect(safeRedirectPath(undefined)).toBe("/");
    expect(safeRedirectPath(undefined, "/home")).toBe("/home");
  });
});

describe("JtiReplayGuard", () => {
  it("accepts a jti once, rejects the replay", () => {
    const g = new JtiReplayGuard();
    expect(g.check("a")).toBe(true);
    expect(g.check("a")).toBe(false);
    expect(g.check("b")).toBe(true);
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
});
