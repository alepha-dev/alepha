import type { RequirementResource } from "./schemas/requirementResourceSchema.ts";

/**
 * A release's readiness (#E153, #Q3774): its Must and Should requirements
 * verified out of all, and the failing Musts by name. Pure, so the
 * Requirements page, the publish guard and `requirement_coverage` count
 * the same way.
 */
export interface RequirementReadiness {
  must: { verified: number; total: number };
  should: { verified: number; total: number };
  failingMust: Array<{ number: number; statement: string }>;
}

export const readinessOf = (
  rows: Array<
    Pick<RequirementResource, "number" | "statement" | "priority" | "status">
  >,
): RequirementReadiness => {
  const count = (priority: "must" | "should") => {
    const mine = rows.filter((it) => it.priority === priority);
    return {
      verified: mine.filter((it) => it.status === "verified").length,
      total: mine.length,
    };
  };
  return {
    must: count("must"),
    should: count("should"),
    failingMust: rows
      .filter((it) => it.priority === "must" && it.status === "failing")
      .map((it) => ({ number: it.number, statement: it.statement }))
      .sort((a, b) => a.number - b.number),
  };
};

/**
 * The requirements a release ships: those whose target release is it.
 */
export const requirementsOfRelease = <
  T extends Pick<RequirementResource, "targetRelease">,
>(
  rows: T[],
  releaseId: number | undefined,
): T[] =>
  releaseId === undefined
    ? rows
    : rows.filter((it) => it.targetRelease?.id === releaseId);
