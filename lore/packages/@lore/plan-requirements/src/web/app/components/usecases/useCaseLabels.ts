import {
  Archive,
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  Hammer,
  PencilLine,
} from "lucide-react";

import type { ActorRole } from "../../../../api/schemas/actorRoleSchema.ts";
import type { CriterionMethod } from "../../../../api/schemas/criterionMethodSchema.ts";
import type { UseCasePriority } from "../../../../api/schemas/useCasePrioritySchema.ts";
import type { UseCaseRunState } from "../../../../api/schemas/useCaseRunStateSchema.ts";
import type { UseCaseStatus } from "../../../../api/schemas/useCaseStatusSchema.ts";

/**
 * The label key of every use case enum value (#E153), written out so each
 * key has a call site.
 */
export const USE_CASE_STATUS_LABEL_KEYS = {
  draft: "requirements.usecase.status.draft",
  ready: "requirements.usecase.status.ready",
  validated: "requirements.usecase.status.validated",
  deprecated: "requirements.usecase.status.deprecated",
} as const satisfies Record<UseCaseStatus, string>;

export const USE_CASE_PRIORITY_LABEL_KEYS = {
  low: "requirements.usecase.priority.low",
  medium: "requirements.usecase.priority.medium",
  high: "requirements.usecase.priority.high",
} as const satisfies Record<UseCasePriority, string>;

export const ACTOR_ROLE_LABEL_KEYS = {
  primary: "requirements.usecase.role.primary",
  beneficiary: "requirements.usecase.role.beneficiary",
  system: "requirements.usecase.role.system",
} as const satisfies Record<ActorRole, string>;

export const CRITERION_METHOD_LABEL_KEYS = {
  e2e: "requirements.usecase.method.e2e",
  agent: "requirements.usecase.method.agent",
  manual: "requirements.usecase.method.manual",
} as const satisfies Record<CriterionMethod, string>;

export const USE_CASE_STATUS_TONE = {
  draft: "neutral",
  ready: "info",
  validated: "success",
  deprecated: "warning",
} as const satisfies Record<UseCaseStatus, string>;

export const USE_CASE_STATUS_ICONS = {
  draft: PencilLine,
  ready: CircleDot,
  validated: CircleCheck,
  deprecated: Archive,
} as const satisfies Record<UseCaseStatus, unknown>;

/**
 * A priority's tone and glyph, the pair a quest's priority chip carries.
 */
export const USE_CASE_PRIORITY_TONE = {
  high: "danger",
  medium: "warning",
  low: "info",
} as const satisfies Record<UseCasePriority, string>;

export const USE_CASE_PRIORITY_ICONS = {
  high: ChevronsUp,
  medium: ChevronUp,
  low: ChevronDown,
} as const satisfies Record<UseCasePriority, unknown>;

export const RUN_STATE_LABEL_KEYS = {
  passed: "requirements.run.state.passed",
  failed: "requirements.run.state.failed",
  in_development: "requirements.run.state.in_development",
  never_run: "requirements.run.state.never_run",
} as const satisfies Record<UseCaseRunState, string>;

export const RUN_STATE_TONE = {
  passed: "success",
  failed: "danger",
  in_development: "info",
  never_run: "neutral",
} as const satisfies Record<UseCaseRunState, string>;

export const RUN_STATE_ICONS = {
  passed: CircleCheck,
  failed: CircleX,
  in_development: Hammer,
  never_run: CircleDashed,
} as const satisfies Record<UseCaseRunState, unknown>;
