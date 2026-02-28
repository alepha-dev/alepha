import { $atom, t } from "alepha";
import { taskResourceSchema } from "@/api/schemas/taskResourceSchema.ts";

export const currentTaskAtom = $atom({
  name: "rdm.current.task",
  schema: t.optional(taskResourceSchema),
});
