import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * How many quests sat in each state at the end of a UTC day (#Q2998), one row
 * per project and day, plus one per epic, release and area that held work.
 *
 * There is no status column to count: a state is derived from timestamps, and
 * `QuestFlowHistory` rebuilds the past from them, approximately. This table is
 * what makes the history exact from the day it started being written, and
 * cheap: a cumulative flow reads a few rows a day instead of every quest.
 *
 * Written by `QuestFlowService.snapshot` and never edited: a row is what was
 * true that night. Which is why a report filtered by tag, priority or member
 * cannot read it and reconstructs instead.
 *
 * `subject` is what the row is about inside its `dimension`: empty for the
 * project, the epic or release id, or the area's name.
 *
 * ⚠️ A new table with no default on a parent, so the migration is one additive
 * `CREATE TABLE`. It cascades from `projects`, and nothing references it.
 */
export const questFlowDaily = $entity({
  name: "quest_flow_daily",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * UTC `YYYY-MM-DD`, the shape `SqlExpressionProvider.dateDay` produces.
     */
    day: z.string().max(10),
    dimension: z.enum(["project", "epic", "release", "area"]).meta({
      mode: "text",
    }),
    subject: z.string(),
    todo: z.integer(),
    inProgress: z.integer(),
    onHold: z.integer(),
    done: z.integer(),
  }),
  indexes: [
    {
      columns: ["projectId", "dimension", "subject", "day"],
      unique: true,
    },
    {
      columns: ["projectId", "day"],
    },
  ],
});

export type QuestFlowDaily = Infer<typeof questFlowDaily.schema>;
