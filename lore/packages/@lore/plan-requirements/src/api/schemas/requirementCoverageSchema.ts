import { type Infer, z } from "alepha";

import { requirementStatusSchema } from "./requirementStatusSchema.ts";

/**
 * A project's coverage (#E153, #Q3774), for a release or for all: the
 * readiness counts, the failing Musts, and the four gap lists, each with
 * what fixes it.
 */
export const requirementCoverageSchema = z.object({
  release: z
    .object({ id: z.integer(), tag: z.string().optional(), title: z.string() })
    .optional(),
  must: z.object({ verified: z.integer(), total: z.integer() }),
  should: z.object({ verified: z.integer(), total: z.integer() }),
  failingMust: z.array(
    z.object({ number: z.integer(), statement: z.string() }),
  ),
  /**
   * Whether publishing this release is refused (Plan's `blockFailingMust`
   * on, and a Must failing).
   */
  blocking: z.boolean(),
  gaps: z.object({
    requirementsNotVerified: z.array(
      z.object({
        number: z.integer(),
        statement: z.string(),
        status: requirementStatusSchema,
      }),
    ),
    useCasesWithoutRequirement: z.array(
      z.object({ number: z.integer(), title: z.string() }),
    ),
    personasWithoutPassingUseCase: z.array(
      z.object({ number: z.integer(), name: z.string() }),
    ),
    epicsWithoutUseCase: z.array(
      z.object({ id: z.integer(), number: z.integer(), title: z.string() }),
    ),
  }),
});

export type RequirementCoverage = Infer<typeof requirementCoverageSchema>;

/**
 * Everything a requirement leads to (#Q3774): its criteria per use case,
 * the epics covering them with their quests and commits, the errors its
 * criteria opened, and the release it ships in (or its metric).
 */
export const requirementImpactSchema = z.object({
  useCases: z.array(
    z.object({
      number: z.integer(),
      title: z.string(),
      stale: z.boolean(),
      criteria: z.array(
        z.object({
          key: z.string(),
          result: z.enum(["passed", "failed", "not_run"]).optional(),
        }),
      ),
    }),
  ),
  epics: z.array(
    z.object({
      number: z.integer(),
      title: z.string(),
      done: z.integer(),
      total: z.integer(),
    }),
  ),
  quests: z.array(
    z.object({
      number: z.integer(),
      title: z.string(),
      completed: z.boolean(),
    }),
  ),
  commits: z.object({ count: z.integer(), last: z.string().optional() }),
  errors: z.array(
    z.object({
      id: z.integer(),
      name: z.string(),
      message: z.string(),
      status: z.string(),
      lastSeenAt: z.string(),
    }),
  ),
});

export type RequirementImpact = Infer<typeof requirementImpactSchema>;
