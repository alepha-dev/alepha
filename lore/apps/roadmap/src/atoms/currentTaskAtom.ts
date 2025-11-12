import { $atom, t } from "@alepha/core";
import { tasks } from "../entities/tasks.ts";

export const currentTaskAtom = $atom({
  name: "current_task",
  schema: t.optional(tasks.schema),
});
