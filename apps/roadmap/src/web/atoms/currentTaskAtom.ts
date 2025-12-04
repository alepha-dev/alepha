import { $atom, t } from "alepha";
import { tasks } from "../../api/entities/tasks.ts";

export const currentTaskAtom = $atom({
  name: "current_task",
  schema: t.optional(tasks.schema),
});
