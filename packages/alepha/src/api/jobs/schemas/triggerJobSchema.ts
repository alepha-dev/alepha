import { type Static, t } from "alepha";

export const triggerJobSchema = t.object({
  name: t.text(),
  payload: t.optional(t.record(t.text(), t.any())),
});

export type TriggerJob = Static<typeof triggerJobSchema>;
