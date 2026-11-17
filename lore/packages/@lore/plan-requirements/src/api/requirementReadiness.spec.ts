import { describe, expect, it } from "vitest";

import { readinessOf, requirementsOfRelease } from "./requirementReadiness.ts";

const r = (
  number: number,
  priority: "must" | "should" | "could",
  status: string,
  release?: number,
) =>
  ({
    number,
    statement: `S${number}`,
    priority,
    status,
    targetRelease: release ? { id: release } : undefined,
  }) as never;

describe("readinessOf", () => {
  it("counts verified Musts and Shoulds and names the failing Musts", () => {
    expect(
      readinessOf([
        r(1, "must", "verified"),
        r(5, "must", "failing"),
        r(2, "must", "covered"),
        r(3, "should", "verified"),
        r(4, "should", "failing"),
        r(6, "could", "failing"),
      ]),
    ).toEqual({
      must: { verified: 1, total: 3 },
      should: { verified: 1, total: 2 },
      failingMust: [{ number: 5, statement: "S5" }],
    });
  });

  it("keeps a release's requirements, or all without one", () => {
    const rows = [r(1, "must", "verified", 3), r(2, "must", "verified", 4)];
    expect(requirementsOfRelease(rows, 3)).toHaveLength(1);
    expect(requirementsOfRelease(rows, undefined)).toHaveLength(2);
  });
});
