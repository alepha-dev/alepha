import { $atom, t } from "alepha";
import { projects } from "../../../api/entities/projects.ts";

export const currentProjectAtom = $atom({
  name: "rdm.current.project",
  schema: t.optional(projects.schema),
});
