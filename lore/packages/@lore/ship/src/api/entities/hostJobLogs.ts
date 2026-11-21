import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { hostJobs } from "./hostJobs.ts";

/**
 * A running job's log as it arrives (#Q3984): one row per `log` frame
 * kept, in order of `offset` within its stream. The page reads them while
 * the job runs; at the end they are written whole to the bucket and
 * deleted. Bounded by Bay's per-job cap (8 MiB) and its 16 KB frames.
 */
export const hostJobLogs = $entity({
  name: "host_job_logs",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    jobId: db.ref(z.uuid(), () => hostJobs.cols.id, { onDelete: "cascade" }),
    stream: z.enum(["stdout", "stderr"]).meta({ mode: "text" }),
    offset: z.integer().min(0),
    data: z.string().max(65_536),
  }),
  indexes: [{ columns: ["jobId", "stream", "offset"], unique: true }],
});

export type HostJobLog = Infer<typeof hostJobLogs.schema>;
