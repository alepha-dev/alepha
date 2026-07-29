import { type Static, z } from "alepha";
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
});

export type QuestWatcher = Static<typeof questWatchers.schema>;
