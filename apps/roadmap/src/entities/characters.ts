import { type Static, t } from "alepha";
import { users } from "alepha/api/users";
import { $entity, pg } from "alepha/orm";
import { projects } from "./projects.js";

export const characters = $entity({
  name: "characters",
  schema: t.object({
    id: pg.primaryKey(t.integer()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    userId: pg.ref(t.uuid(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    projectId: pg.ref(t.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    xp: t.integer(),
    balance: pg.default(t.integer(), 0),
    owner: pg.default(t.boolean(), true),
  }),
});

export type Character = Static<typeof characters.schema>;
