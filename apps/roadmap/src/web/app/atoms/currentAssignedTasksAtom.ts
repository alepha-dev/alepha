import { $atom, t } from "alepha";
import { tasks } from "../../../api/entities/tasks.ts";

export const currentAssignedTasksAtom = $atom({
  name: "rdm.current.assigned_tasks",
  schema: t.optional(t.array(tasks.schema)),
});
