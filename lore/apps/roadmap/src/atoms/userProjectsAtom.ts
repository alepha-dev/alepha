import { $atom, t } from "@alepha/core";
import { projects } from "../entities/projects.ts";

export const userProjectsAtom = $atom({
  name: "user_projects",
  schema: t.optional(t.array(projects.schema)),
});
