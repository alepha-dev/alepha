import { type Infer, z } from "alepha";

/**
 * One step of an execution as the admin shows it: the timeline entry
 * `getExecution` returns, ordered by `at`.
 *
 * `hasResult` says whether the step stored a result at all (a step that
 * returned nothing stores none), and `resultPreview` is that result as
 * indented JSON, cut at 2048 characters. A sleep carries `until` and no
 * result.
 */
export const jobStepViewSchema = z.object({
  name: z.text(),
  at: z.datetime(),
  ms: z.integer(),
  until: z.datetime().optional(),
  hasResult: z.boolean(),
  resultPreview: z.text({ maxLength: 2048 }).optional(),
});

export type JobStepView = Infer<typeof jobStepViewSchema>;
