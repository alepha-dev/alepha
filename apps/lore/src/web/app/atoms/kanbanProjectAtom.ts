import { $atom, z } from "alepha";

import { projectResourceSchema } from "@/api/schemas/projectResourceSchema.ts";

export const kanbanProjectAtom = $atom({
  name: "lor.kanban.project",
  schema: z
    .object({
      project: projectResourceSchema,
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
