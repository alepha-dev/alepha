import { $atom, z } from "alepha";
import { projects } from "@/api/entities/projects.ts";

export const kanbanProjectAtom = $atom({
  name: "lor.kanban.project",
  schema: z
    .object({
      project: projects.schema,
    })
    .optional(),
});

export const kanbanReloadAtom = $atom({
  name: "lor.kanban.reload",
  schema: z.object({
    key: z.integer(),
  }),
  default: { key: 0 },
});
