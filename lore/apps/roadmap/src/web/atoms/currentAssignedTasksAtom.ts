import { $atom, t } from "alepha";
import { tasks } from "../../api/entities/tasks.ts";

export const currentAssignedTasksAtom = $atom({
  name: "current_assigned_tasks",
  schema: t.optional(t.array(tasks.schema)),
});
