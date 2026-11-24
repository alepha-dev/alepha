import { type Infer, z } from "alepha";

/**
 * What started a run (#Q4275): a member by hand (`hand`, the job's
 * `startedBy`), a project event (`event`, with its name), or the prompt's
 * schedule (`schedule`).
 */
export const promptJobCauseSchema = z.object({
  kind: z.enum(["hand", "event", "schedule"]),
  event: z.string().max(64).optional(),
});

export type PromptJobCause = Infer<typeof promptJobCauseSchema>;
