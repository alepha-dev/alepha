import { t } from "@alepha/core";

export const taskCreateSchema = t.object({
  title: t.string(),
  description: t.string({ size: "rich" }),
  package: t.string(),
  priority: t.enum(["optional", "low", "medium", "high"]),
  complexity: t.int({ minimum: 1, maximum: 5 }),
  projectId: t.int(),
  objectives: t.optional(
    t.array(
      t.object({
        title: t.string(),
        completed: t.boolean(),
      }),
      { default: [] },
    ),
  ),
});
