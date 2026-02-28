import { $atom, t } from "alepha";
import { taskResourceSchema } from "@/api/schemas/taskResourceSchema.ts";

export const currentAssignedTasksAtom = $atom({
  name: "rdm.current.assigned_tasks",
  schema: t.optional(t.array(taskResourceSchema)),
});
