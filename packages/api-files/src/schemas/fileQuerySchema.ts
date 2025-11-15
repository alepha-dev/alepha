import type { Static } from "@alepha/core";
import { t } from "@alepha/core";
import { pageQuerySchema } from "@alepha/orm";

export const fileQuerySchema = t.extend(pageQuerySchema, {
  bucket: t.optional(t.string()),
  tags: t.optional(t.array(t.string())),
  name: t.optional(t.string()),
  mimeType: t.optional(t.string()),
  creator: t.optional(t.uuid()),
  createdAfter: t.optional(t.datetime()),
  createdBefore: t.optional(t.datetime()),
});

export type FileQuery = Static<typeof fileQuerySchema>;
