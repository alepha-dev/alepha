import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

import { hostJobInputSchema } from "../schemas/hostJobInputSchema.ts";
import { HOST_JOB_KINDS, HOST_JOB_STATUSES } from "../schemas/hostJobValues.ts";
import { hostCommands } from "./hostCommands.ts";
import { hosts } from "./hosts.ts";
import { projects } from "./projects.ts";

/**
 * One run of a one-shot job on a host (#Q3984): an agent job today, CI
 * later. Never `jobs`: the framework's `$job` owns `job_executions`, and
 * Lore has `automation_runs`, `quality_runs` and `use_case_runs`.
 *
 * A job reaches its machine as a `job-run` host command (`commandId`); the
 * command is the transport and this row is the run. One job runs at a time
 * on a host, the others wait `queued`, first in first out.
 *
 * The live log is `host_job_logs`, appended as Bay's `log` frames arrive;
 * at the end it is written whole to the bucket (`logFileId`) and the rows
 * are dropped.
 *
 * Hangs off `hosts` and `projects` with `cascade`; the command link is
 * `set null`, since commands are pruned by count and a job's history
 * outlives that.
 */
export const hostJobs = $entity({
  name: "host_jobs",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    hostId: db.ref(z.uuid(), () => hosts.cols.id, { onDelete: "cascade" }),
    kind: z.enum(HOST_JOB_KINDS).meta({ mode: "text" }),
    status: db.default(
      z.enum(HOST_JOB_STATUSES).meta({ mode: "text" }),
      "queued",
    ),
    input: hostJobInputSchema,
    startedBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    /**
     * The job whose output started this one: the chain the agent job's
     * guard walks, so an agent's output never starts its own successor.
     * A soft reference, read by id.
     */
    startedByJobId: z.uuid().optional(),
    /** What the job is about, for its page: `feedback`, `quest`, `host`. */
    subjectType: z.string().max(32).optional(),
    subjectId: z.string().max(64).optional(),
    commandId: db.ref(z.uuid().optional(), () => hostCommands.cols.id, {
      onDelete: "set null",
    }),
    queuedAt: z.string(),
    startedAt: z.string().optional(),
    endedAt: z.string().optional(),
    reason: z.string().max(2000).optional(),
    exitCode: z.integer().optional(),
    /**
     * The whole log, both streams, written to the bucket at the end. A
     * logical reference, like `host_commands.resultFileId`.
     */
    logFileId: z.uuid().optional(),
    logBytes: z.integer().min(0).optional(),
    /** Set once a stream reached Bay's per-job cap. */
    logTruncated: z.boolean().optional(),
    /**
     * What the kind's reader made of the output: the final result, the
     * cost and usage Claude Code reports.
     */
    result: z.record(z.string(), z.any()).optional(),
    /** How many times a `paused` job was queued again. */
    retries: z.integer().min(0).optional(),
    /** When a `paused` job may be queued again. */
    retryAt: z.string().optional(),
  }),
  indexes: [
    // The dispatcher: the oldest queued job of a host, and its running one.
    { columns: ["hostId", "status", "queuedAt"] },
    // The project's job list, newest first.
    { columns: ["projectId", "queuedAt"] },
    { columns: ["commandId"] },
  ],
});

export type HostJob = Infer<typeof hostJobs.schema>;
