import { type Infer, z } from "alepha";

export const triggerJobSchema = z.object({
  payload: z.record(z.text(), z.any()).optional(),
});

export type TriggerJob = Infer<typeof triggerJobSchema>;
