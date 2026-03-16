import { t } from "alepha";

export const postPublishParamsSchema = t.object({
  slug: t.shortText({
    description: "Slug of the post to publish or unpublish.",
  }),
  publish: t.boolean({ description: "true to publish, false to unpublish." }),
});
