import { describe, it } from "vitest";

import {
  EMPTY_BAR,
  MIN_BAR,
  momentumBarHeights,
  momentumDelta,
} from "./homeMomentumBars.ts";

describe("momentum bar heights", () => {
  it("scales every row against the shared ceiling, not its own", ({
    expect,
  }) => {
    // The same counts under a higher ceiling draw shorter bars: a quiet
    // project reads as quiet next to a busy one.
    const alone = momentumBarHeights([1, 2], 2, 32);
    const beside = momentumBarHeights([1, 2], 20, 32);

    expect(alone[1]).toBeGreaterThan(beside[1]!);
    expect(alone[1]).toBe(32);
  });

  it("keeps a day with one event visible above the baseline", ({ expect }) => {
    // 1 out of 400 rounds to nothing, which would say the day was empty.
    const [bar] = momentumBarHeights([1], 400, 32);

    expect(bar).toBe(MIN_BAR);
  });

  it("draws an empty day as a hairline, not as nothing", ({ expect }) => {
    const [bar] = momentumBarHeights([0], 40, 32);

    expect(bar).toBe(EMPTY_BAR);
  });

  it("never draws past the top of the box", ({ expect }) => {
    const bars = momentumBarHeights([0, 3, 40, 12], 40, 32);

    for (const bar of bars) {
      expect(bar).toBeLessThanOrEqual(32);
    }
  });
});

describe("momentum delta", () => {
  it("compares the last seven days with the seven before", ({ expect }) => {
    const counts = [...Array(7).fill(1), ...Array(7).fill(2)];

    expect(momentumDelta(counts)).toBe(100);
  });

  it("says nothing when the earlier week was empty", ({ expect }) => {
    const counts = [...Array(7).fill(0), ...Array(7).fill(5)];

    expect(momentumDelta(counts)).toBeUndefined();
  });

  it("goes negative when the project slows down", ({ expect }) => {
    const counts = [...Array(7).fill(4), ...Array(7).fill(1)];

    expect(momentumDelta(counts)).toBe(-75);
  });
});
