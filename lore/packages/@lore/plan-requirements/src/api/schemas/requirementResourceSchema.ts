import { type Infer, z } from "alepha";

import { requirements } from "../entities/requirements.ts";
import { metricStatusSchema } from "./requirementMetricSchema.ts";
import { requirementStatusSchema } from "./requirementStatusSchema.ts";

/**
 * A requirement as every surface reads it (#E153): the row, the criteria
 * verifying it, the epics covering it (through those criteria's use cases),
 * the personas playing those use cases, its target release with how it was
 * set, and its computed status.
 */
export const requirementResourceSchema = requirements.schema
  .omit({ deletedAt: true })
  .extend({
    criteria: z.array(
      z.object({
        useCaseId: z.integer(),
        useCaseNumber: z.integer(),
        useCaseTitle: z.string(),
        key: z.string(),
        summary: z.string(),
        method: z.string(),
        /**
         * Its result in its use case's latest run, when it ran.
         */
        result: z.enum(["passed", "failed", "not_run"]).optional(),
      }),
    ),
    coveringEpics: z.array(
      z.object({
        id: z.integer(),
        number: z.integer(),
        title: z.string(),
        releaseId: z.integer().optional(),
      }),
    ),
    personas: z.array(z.object({ number: z.integer(), name: z.string() })),
    targetRelease: z
      .object({
        id: z.integer(),
        number: z.integer(),
        tag: z.string().optional(),
        title: z.string().optional(),
        /**
         * `auto`: derived from the covering epics, never stored. `by_hand`:
         * the stored value, which counts only while no covering epic sits in
         * a release.
         */
        mode: z.enum(["auto", "by_hand"]),
      })
      .optional(),
    status: requirementStatusSchema,
    /**
     * A metric requirement's last 14 days, oldest first (#Q3773).
     */
    metricDays: z.array(
      z.object({
        day: z.string(),
        value: z.number().optional(),
        status: metricStatusSchema,
      }),
    ),
  });

export type RequirementResource = Infer<typeof requirementResourceSchema>;
