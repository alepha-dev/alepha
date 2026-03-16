import { t } from "alepha";

export const postCreateSchema = t.object({
  title: t.text({
    title: "Title",
    $control: { text: { placeholder: "My awesome post" } },
  }),
  slug: t.shortText({
    title: "Slug",
    $control: { text: { placeholder: "my-awesome-post" } },
  }),
  summary: t.text({
    title: "Summary",
    $control: {
      area: {
        placeholder: "A brief summary for list pages and RSS",
        minRows: 2,
      },
    },
  }),
  content: t.richText({
    title: "Content (Markdown)",
    $control: {
      area: {
        placeholder: "Write your post in Markdown...",
        minRows: 15,
        autosize: true,
        styles: { input: { fontFamily: "monospace" } },
      },
    },
  }),
  tags: t.optional(
    t.array(t.string(), {
      default: [],
      title: "Tags",
      $control: {
        select: {
          creatable: true,
          tagsInputProps: { placeholder: "Press Enter to add a tag" },
        },
      },
    }),
  ),
  coverImage: t.optional(
    t.string({
      title: "Cover Image URL",
      $control: { text: { placeholder: "https://..." } },
    }),
  ),
});
