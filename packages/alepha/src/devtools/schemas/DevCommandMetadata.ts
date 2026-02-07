import { type Static, t } from "alepha";

export const devCommandMetadataSchema = t.object({
  name: t.text(),
  description: t.optional(t.text()),
  hidden: t.optional(t.boolean()),
});

export type DevCommandMetadata = Static<typeof devCommandMetadataSchema>;
