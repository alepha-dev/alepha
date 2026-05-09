import { type Static, t } from "alepha";
import { $entity, db } from "alepha/orm";

export const files = $entity({
  name: "files",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    organizationId: db.organization(),
    blobId: t.text(),
    creator: t.optional(t.uuid()),
    creatorRealm: t.optional(t.string()),
    creatorName: t.optional(t.string()),
    bucket: t.text(),
    expirationDate: t.optional(t.datetime()),
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

export type FileEntity = Static<typeof files.schema>;
