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
    /**
     * Display name. Mutable via `FileService.updateFile` — can be renamed
     * by callers (e.g. an Archive UI letting users rename uploaded blobs).
     * Initialized to the uploader's filename at upload time. Use
     * `originalName` if you need the as-uploaded filename after a rename.
     */
    name: t.text(),
    /**
     * Immutable record of the uploader's filename at upload time. Set once
     * by `FileService.uploadFile` and the `bucket:file:uploaded` hook;
     * `FileService.updateFile` never touches it. Useful for download
     * headers (Content-Disposition), audit trails, and any UI that wants
     * to show "originally uploaded as X" alongside a renamed file.
     */
    originalName: t.optional(t.string()),
    size: t.number(),
    mimeType: t.string(),
    /**
     * Free-form taxonomy. Normalized server-side (trim/lowercase/dedupe is
     * caller's responsibility for now). Use with `FileQuery.tags` to
     * filter via array-contains.
     */
    tags: t.optional(t.array(t.text())),
    /**
     * SHA-256 hex digest of the file content (64 lowercase hex chars).
     * Computed at upload time by `FileService.calculateChecksum`. Stable
     * — never recomputed after upload. Use for integrity verification,
     * content-based dedup, or downstream virus-scan correlation.
     */
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
