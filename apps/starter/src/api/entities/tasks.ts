import { type Static, t } from "@alepha/core";
import { $entity, pg } from "@alepha/postgres";

export const tasks = $entity({
  name: "tasks",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    name: t.text(),
  }),
});

export type TaskEntity = Static<typeof tasks.schema>;
