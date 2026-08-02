import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { archiveDirectories } from "./archiveDirectories.ts";
import { campaigns } from "./campaigns.ts";

/**
 * Lore-side overlay table on top of the framework `files` entity (see
 * `alepha/api/files`). The framework owns the bytes + framework
 * metadata (size, mime, checksum/sha256, originalName, tags); Lore
 * owns the campaign-scoping + Archive tree position.
 *
 * `fileId` is both the PK and the FK back to `files`. One archive_blob
 * row per file, one file per archive_blob row. Cascade-delete in both
 * directions — wiping the framework file row wipes the overlay; wiping
 * the campaign wipes both.
 *
 * `directoryId` NULL means "lives at the campaign root". Name + parent
 * uniqueness is enforced via the `archive_names` reservation table
 * (shared with folios and directories so a folio and a blob can't have
 * the same name in the same folder).
 */
export const archiveBlobs = $entity({
  name: "archive_blobs",
  schema: z.object({
    fileId: db.primaryKey(z.uuid()),
    /** Per-campaign sequential id. URL form is `blob:#42`. */
    shortId: z.integer().min(1),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    campaignId: db.ref(z.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    directoryId: db.ref(z.uuid().optional(), () => archiveDirectories.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Display name within the archive tree. Mirrors `files.name` at
     * write time, but the Archive UI lets users rename — and the
     * uniqueness reservation lives on this column, not on the
     * framework's `files.name`. The framework's `files.originalName`
     * preserves the as-uploaded filename.
     */
    name: z.string().min(1).max(200),
  }),
  indexes: [
    { columns: ["campaignId", "shortId"], unique: true },
    { columns: ["directoryId"] },
  ],
});

export type ArchiveBlob = Infer<typeof archiveBlobs.schema>;
