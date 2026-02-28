import { $atom, t } from "alepha";
import { projects } from "@/api/entities/projects.ts";

export const kanbanProjectAtom = $atom({
  name: "rdm.kanban.project",
  schema: t.optional(
    t.object({
      project: projects.schema,
      readOnly: t.boolean(),
    }),
  ),
});

export const kanbanReloadAtom = $atom({
  name: "rdm.kanban.reload",
  schema: t.object({
    key: t.integer(),
  }),
  default: { key: 0 },
});
