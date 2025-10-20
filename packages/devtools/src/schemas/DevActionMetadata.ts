import { type Static, t } from "@alepha/core";

export const devActionMetadataSchema = t.object({
  name: t.text(),
  group: t.text(),
  method: t.text(),
  path: t.text(),
  prefix: t.text(),
  fullPath: t.text(),
  description: t.optional(t.text()),
  summary: t.optional(t.text()),
  disabled: t.optional(t.boolean()),
  secure: t.optional(t.boolean()),
  hide: t.optional(t.boolean()),
  body: t.optional(t.any()),
  params: t.optional(t.any()),
  query: t.optional(t.any()),
  response: t.optional(t.any()),
  bodyContentType: t.optional(t.text()),
});

export type DevActionMetadata = Static<typeof devActionMetadataSchema>;
