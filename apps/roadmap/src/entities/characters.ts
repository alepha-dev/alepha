import { users } from "@alepha/api-users";
import { type Static, t } from "@alepha/core";
import { $entity, pg } from "@alepha/postgres";
import { projects } from "./projects.js";

export const characters = $entity({
  name: "characters",
  schema: t.object({
    id: pg.primaryKey(t.int()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    userId: pg.ref(t.uuid(), () => users.cols.id, {
      onDelete: "cascade",
    }),
    projectId: pg.ref(t.int(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    xp: t.int(),
    balance: pg.default(t.int(), 0),
    owner: pg.default(t.boolean(), true),
  }),
});

export type Character = Static<typeof characters.schema>;
