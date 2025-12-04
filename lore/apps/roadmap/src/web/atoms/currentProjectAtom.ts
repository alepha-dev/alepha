import { $atom, t } from "alepha";
import { projects } from "../../api/entities/projects.ts";

export const currentProjectAtom = $atom({
  name: "current_project",
  schema: t.optional(projects.schema),
});
