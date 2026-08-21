import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { quests } from "./quests.ts";
import { users } from "./users.ts";

/**
 * Junction table for the many-to-many between users and quests.
 *
 * Nothing about it is special — it is a normal entity. Only the relation
 * declaration knows it is a junction, via `.through()`.
 */
export const questWatchers = $entity({
  name: "quest_watchers",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    questId: db.ref(z.integer(), () => quests.cols.id, {
      onDelete: "cascade",
    }),
    userId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
  }),
  indexes: [
    // A junction row is the pair, so the pair is unique. It also gives
    // `upsert` a conflict target to aim at — without it there is nothing for
    // ON CONFLICT to match and the statement fails.
    { columns: ["questId", "userId"], unique: true },
  ],
});

export type QuestWatcher = Infer<typeof questWatchers.schema>;
