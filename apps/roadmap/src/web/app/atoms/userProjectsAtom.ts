import { $atom, t } from "alepha";
import { projects } from "@/api/entities/projects.ts";

export const userProjectsAtom = $atom({
  name: "rdm.user.projects",
  schema: t.optional(t.array(projects.schema)),
});
