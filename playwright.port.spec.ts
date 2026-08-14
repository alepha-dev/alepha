import { describe, it } from "vitest";
import { derivePort } from "./playwright.port.ts";

/**
 * Every app's default in the primary checkout. New apps must stay in the 33xx
 * band with unique last-two-digits — that is what keeps their worktree offsets
 * distinct.
 */
const DEFAULTS = [3302, 3303, 3304, 3305, 3311, 3312];

describe("derivePort", () => {
  it("never collides two apps inside the same worktree, for any root", ({
    expect,
  }) => {
    // The old per-app-seeded hash made an intra-worktree collision a 1-in-500
    // per pair — and one real worktree hit it: shop (3305) and example-ssr
    // (3312) both derived 3638, so shop's server always held the port when
    // example-ssr's tried to bind, and `yarn v` failed deterministically while
    // each suite passed alone. Sweep many roots so any per-root collision in a
    // future formula is caught here, not by a 10-minute verify run.
    for (let i = 0; i < 500; i++) {
      const root = `/home/user/git/alepha/.claude/worktrees/wt-${i}`;
      const ports = DEFAULTS.map((d) => derivePort(root, d));
      expect(new Set(ports).size).toBe(DEFAULTS.length);
    }
  });

  it("stays inside the documented 3400-3899 worktree band", ({ expect }) => {
    for (let i = 0; i < 500; i++) {
      const root = `/tmp/some/checkout-${i}`;
      for (const d of DEFAULTS) {
        const port = derivePort(root, d);
        expect(port).toBeGreaterThanOrEqual(3400);
        expect(port).toBeLessThanOrEqual(3899);
      }
    }
  });

  it("is stable for a given root, so a failing run can be re-attached to", ({
    expect,
  }) => {
    const root = "/home/user/git/alepha/.claude/worktrees/stable";
    expect(derivePort(root, 3302)).toBe(derivePort(root, 3302));
  });
});
