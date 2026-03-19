import { type Static, t } from "alepha";

export const devTopicMetadataSchema = t.object({
  name: t.text(),
  description: t.optional(t.text()),
  schema: t.optional(t.any()),
  provider: t.text(),
  subscribers: t.integer(),
});

export type DevTopicMetadata = Static<typeof devTopicMetadataSchema>;
