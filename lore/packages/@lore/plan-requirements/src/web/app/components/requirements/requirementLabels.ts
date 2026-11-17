import type { RequirementPriority } from "../../../../api/schemas/requirementPrioritySchema.ts";
import type { RequirementStatus } from "../../../../api/schemas/requirementStatusSchema.ts";
import type { RequirementType } from "../../../../api/schemas/requirementTypeSchema.ts";

/**
 * The label key of every requirement enum value (#E153), written out so
 * each key has a call site.
 */
export const REQUIREMENT_TYPE_LABEL_KEYS = {
  functional: "requirements.requirement.type.functional",
  non_functional: "requirements.requirement.type.non_functional",
  constraint: "requirements.requirement.type.constraint",
} as const satisfies Record<RequirementType, string>;

export const REQUIREMENT_PRIORITY_LABEL_KEYS = {
  must: "requirements.requirement.priority.must",
  should: "requirements.requirement.priority.should",
  could: "requirements.requirement.priority.could",
  wont: "requirements.requirement.priority.wont",
} as const satisfies Record<RequirementPriority, string>;

export const REQUIREMENT_STATUS_LABEL_KEYS = {
  verified: "requirements.requirement.status.verified",
  failing: "requirements.requirement.status.failing",
  in_development: "requirements.requirement.status.in_development",
  covered: "requirements.requirement.status.covered",
  not_covered: "requirements.requirement.status.not_covered",
  no_data: "requirements.requirement.status.no_data",
} as const satisfies Record<RequirementStatus, string>;
