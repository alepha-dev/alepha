import { $atom, t } from "alepha";
import { tasks } from "../../../api/entities/tasks.ts";

export const currentTaskAtom = $atom({
  name: "rdm.current.task",
  schema: t.optional(tasks.schema),
});
