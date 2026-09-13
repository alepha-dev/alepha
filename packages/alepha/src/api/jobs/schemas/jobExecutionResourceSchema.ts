import { type Infer, z } from "alepha";

import { jobExecutionEntity } from "../entities/jobExecutionEntity.ts";

/**
 * Public-facing schema for a job execution row: the entity, plus `can`, the
 * admin actions the row's status allows.
 */
export const jobExecutionResourceSchema = jobExecutionEntity.schema
  .extend({
    can: z.object({
      retry: z.boolean(),
      cancel: z.boolean(),
    }),
  })
  .meta({
    title: "JobExecutionResource",
    description: "A job execution row with derived actions.",
  });

export type JobExecutionResource = Infer<typeof jobExecutionResourceSchema>;
