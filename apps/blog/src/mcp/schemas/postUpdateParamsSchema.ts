import { t } from "alepha";

export const postUpdateParamsSchema = t.object({
  slug: t.shortText({ description: "Slug of the post to update." }),
  title: t.optional(t.text({ description: "New title." })),
  summary: t.optional(t.text({ description: "New summary." })),
  content: t.optional(t.richText({ description: "New content in Markdown." })),
  tags: t.optional(t.array(t.string(), { description: "New tags." })),
});
