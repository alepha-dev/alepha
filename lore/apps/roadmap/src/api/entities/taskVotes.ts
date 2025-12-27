import { type Static, t } from "alepha";
import { users } from "alepha/api/users";
import { $entity, pg } from "alepha/orm";
import { tasks } from "./tasks.ts";

export const taskVotes = $entity({
  name: "task_votes",
  schema: t.object({
    id: pg.primaryKey(t.integer()),
    createdAt: pg.createdAt(),
    taskId: pg.ref(t.integer(), () => tasks.cols.id, {
      onDelete: "cascade",
    }),
    userId: pg.ref(t.uuid(), () => users.cols.id, {
      onDelete: "cascade",
    }),
  }),
  indexes: [
    {
      columns: ["taskId", "userId"],
      unique: true,
    },
  ],
});

export type TaskVote = Static<typeof taskVotes.schema>;
export type TaskVoteInsert = Static<typeof taskVotes.insertSchema>;
