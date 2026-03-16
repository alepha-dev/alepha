import { t } from "alepha";

export const postResourceSchema = t.object({
  id: t.integer(),
  slug: t.shortText(),
  title: t.text(),
  summary: t.text(),
  contentHtml: t.richText(),
  coverImage: t.optional(t.string()),
  tags: t.array(t.string()),
  publishedAt: t.optional(t.datetime()),
  authorId: t.optional(t.uuid()),
  createdAt: t.datetime(),
  updatedAt: t.datetime(),
});
