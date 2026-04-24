import { type Static, t } from "alepha";

export const triggerJobSchema = t.object({
  payload: t.optional(t.record(t.text(), t.any())),
});

export type TriggerJob = Static<typeof triggerJobSchema>;
