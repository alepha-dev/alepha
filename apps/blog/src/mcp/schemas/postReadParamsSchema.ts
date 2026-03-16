import { t } from "alepha";

export const postReadParamsSchema = t.object({
  slug: t.shortText({ description: "Post slug." }),
});
