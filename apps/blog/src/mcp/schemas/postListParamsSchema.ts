import { t } from "alepha";

export const postListParamsSchema = t.object({
  status: t.optional(
    t.enum(["draft", "published"], {
      description: "Filter by status. Omit for all posts.",
    }),
  ),
  tag: t.optional(
    t.text({
      description: "Filter by tag.",
    }),
  ),
});
