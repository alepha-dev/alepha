import { type Static, z } from "alepha";

export const triggerJobSchema = z.object({
  payload: z.record(z.text(), z.any()).optional(),
});

export type TriggerJob = Static<typeof triggerJobSchema>;
