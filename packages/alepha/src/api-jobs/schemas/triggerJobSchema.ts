import type { Static } from "alepha";
import { t } from "alepha";

export const triggerJobSchema = t.object({
  name: t.string(),
});

export type TriggerJob = Static<typeof triggerJobSchema>;
