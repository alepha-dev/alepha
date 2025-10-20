import type { Static } from "@alepha/core";
import { t } from "@alepha/core";

export const triggerJobSchema = t.object({
  name: t.string(),
});

export type TriggerJob = Static<typeof triggerJobSchema>;
