import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

export const tasks = $entity({
  name: "tasks",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    name: t.text(),
  }),
});

export type TaskEntity = Static<typeof tasks.schema>;
