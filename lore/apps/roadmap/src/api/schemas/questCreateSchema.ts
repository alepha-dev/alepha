import { t } from "alepha";

export const questCreateSchema = t.object({
  title: t.string(),
  description: t.string({ size: "rich" }),
  zone: t.string(),
  priority: t.enum(["optional", "low", "medium", "high"]),
  difficulty: t.integer({ minimum: 1, maximum: 5 }),
  campaignId: t.integer(),
  objectives: t.optional(
    t.array(
      t.object({
        title: t.string(),
        completed: t.boolean(),
      }),
      { default: [] },
    ),
  ),
  attachments: t.optional(t.array(t.uuid(), { default: [] })),
});
