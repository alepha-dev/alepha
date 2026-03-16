import { t } from "alepha";

export const postCreateParamsSchema = t.object({
  slug: t.shortText({ description: "URL-friendly slug." }),
  title: t.text({ description: "Post title." }),
  summary: t.text({ description: "Post summary for list pages and RSS." }),
  content: t.richText({ description: "Post content in Markdown." }),
  tags: t.optional(
    t.array(t.string(), { description: "Tags for categorization." }),
  ),
});
