import { t } from "alepha";

export const postUpdateSchema = t.object({
  title: t.optional(t.text({ title: "Title" })),
  summary: t.optional(
    t.text({ title: "Summary", $control: { area: { minRows: 2 } } }),
  ),
  content: t.optional(
    t.richText({
      title: "Content (Markdown)",
      $control: {
        area: {
          minRows: 15,
          autosize: true,
          styles: { input: { fontFamily: "monospace" } },
        },
      },
    }),
  ),
  tags: t.optional(
    t.array(t.string(), {
      title: "Tags",
      $control: { select: { creatable: true } },
    }),
  ),
  coverImage: t.optional(t.string({ title: "Cover Image URL" })),
});
