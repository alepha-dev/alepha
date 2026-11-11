import { type Infer, z } from "alepha";

import { jobExecutionEntity } from "../entities/jobExecutionEntity.ts";
import { jobStepViewSchema } from "./jobStepViewSchema.ts";

/**
 * Public-facing schema for a job execution row: the entity, plus `can`, the
 * admin actions the row's status allows, and `steps` as the run's timeline
 * (ordered, each result a capped preview) instead of the stored record.
 */
export const jobExecutionResourceSchema = jobExecutionEntity.schema
  .extend({
    can: z.object({
      retry: z.boolean(),
      cancel: z.boolean(),
      delete: z.boolean(),
    }),
    steps: z.array(jobStepViewSchema).optional(),
  })
  .meta({
    title: "JobExecutionResource",
    description: "A job execution row with derived actions.",
  });

export type JobExecutionResource = Infer<typeof jobExecutionResourceSchema>;
