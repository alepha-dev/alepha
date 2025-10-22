import { type Static, t } from "@alepha/core";
import { $entity, pg } from "@alepha/postgres";

export const files = $entity({
  name: "files",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    version: pg.version(),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),
    blobId: t.text(),
    creator: t.optional(t.uuid()),
    creatorRealm: t.optional(t.string()),
    creatorName: t.optional(t.string()),
    bucket: t.text(),
    expirationDate: t.optional(t.string()),
    name: t.text(),
    size: t.number(),
    mimeType: t.string(),
    tags: t.optional(t.array(t.text())),
    checksum: t.optional(t.string()),
  }),
  indexes: [
    "expirationDate",
    "bucket",
    "creator",
    "createdAt",
    "mimeType",
    {
      columns: ["bucket", "createdAt"],
    },
  ],
});

export type FileEntity = Static<typeof files.$schema>;
