import { $atom, t } from "alepha";
import { projects } from "../../api/entities/projects.ts";

export const userProjectsAtom = $atom({
  name: "user_projects",
  schema: t.optional(t.array(projects.schema)),
});
