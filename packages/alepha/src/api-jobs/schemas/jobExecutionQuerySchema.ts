import type { Static } from "alepha";
import { t } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const jobExecutionQuerySchema = t.extend(pageQuerySchema, {
  status: t.optional(t.enum(["STARTED", "FAILED", "COMPLETED"])),
  job: t.optional(
    t.text({
      description: "Filter by job name",
    }),
  ),
});

export type JobExecutionQuery = Static<typeof jobExecutionQuerySchema>;
