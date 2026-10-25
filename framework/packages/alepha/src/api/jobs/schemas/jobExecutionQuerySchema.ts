import { type Infer, z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

/**
 * The query of a job's executions page.
 *
 * `sort` is a whitelist, because a column the table does not have throws
 * inside the repository and would answer a 500. `-createdAt` is the default
 * and the tiebreak of every other sort: `startedAt` is null until a worker
 * claims a row, and Postgres and SQLite sort that null at opposite ends. There
 * is no duration sort: a page orders by columns only.
 *
 * `status` sorts by the database's own order of the values: the declaration
 * order of the Postgres enum, the label on SQLite. Rows group by status either
 * way; which group comes first means nothing.
 */
export const jobExecutionQuerySchema = pageQuerySchema.extend({
  sort: z
    .enum([
      "createdAt",
      "-createdAt",
      "startedAt",
      "-startedAt",
      "completedAt",
      "-completedAt",
      "status",
      "-status",
      "attempt",
      "-attempt",
    ])
    .describe("Sort column, '-' for descending. Defaults to -createdAt.")
    .optional(),
  status: z
    .array(
      z.enum(["pending", "running", "scheduled", "ok", "error", "cancelled"]),
    )
    .describe("Keep rows in any of these statuses.")
    .optional(),
  trigger: z
    .enum(["scheduled", "manual", "code"])
    .describe(
      "What started the run: 'scheduled' is a cron tick, 'manual' an admin trigger or retry, 'code' a push from code or devtools.",
    )
    .optional(),
  from: z.datetime().describe("Started at or after (inclusive).").optional(),
  to: z.datetime().describe("Started at or before (inclusive).").optional(),
  key: z.text().describe("Deduplication key contains this text.").optional(),
});

export type JobExecutionQuery = Infer<typeof jobExecutionQuerySchema>;
