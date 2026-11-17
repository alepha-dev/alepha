import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";

/**
 * One cell of the traceability matrix (#E153, #Q3774).
 */
export type MatrixCell =
  | "verified"
  | "failing"
  | "in_development"
  | "stale"
  | "never_run"
  | "none";

/**
 * A requirement against a use case: from the latest result of the criteria
 * of that use case verifying it. A failure is in development while the use
 * case's quests are; a pass is stale when the use case's run is.
 */
export const requirementUseCaseCell = (
  requirement: Pick<RequirementResource, "criteria">,
  useCase: Pick<UseCaseResource, "number" | "state" | "stale">,
): MatrixCell => {
  const mine = requirement.criteria.filter(
    (it) => it.useCaseNumber === useCase.number,
  );
  if (mine.length === 0) return "none";
  if (mine.some((it) => it.result === "failed")) {
    return useCase.state === "in_development" ? "in_development" : "failing";
  }
  if (mine.every((it) => it.result === "passed")) {
    return useCase.stale ? "stale" : "verified";
  }
  return "never_run";
};

/**
 * A requirement against an epic covering it: the requirement's own status.
 */
export const requirementEpicCell = (
  requirement: Pick<RequirementResource, "coveringEpics" | "status">,
  epicNumber: number,
): MatrixCell => {
  if (!requirement.coveringEpics.some((it) => it.number === epicNumber)) {
    return "none";
  }
  return requirement.status === "verified"
    ? "verified"
    : requirement.status === "failing"
      ? "failing"
      : requirement.status === "in_development"
        ? "in_development"
        : "never_run";
};

/**
 * A persona against a use case it acts in: the use case's run state.
 */
export const personaUseCaseCell = (
  personaNumber: number,
  useCase: Pick<UseCaseResource, "actors" | "state" | "stale">,
): MatrixCell => {
  if (!useCase.actors.some((it) => it.number === personaNumber)) return "none";
  return useCase.state === "passed"
    ? useCase.stale
      ? "stale"
      : "verified"
    : useCase.state === "failed"
      ? "failing"
      : useCase.state === "in_development"
        ? "in_development"
        : "never_run";
};
