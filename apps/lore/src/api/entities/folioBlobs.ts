import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { folioDirectories } from "./folioDirectories.ts";
import { projects } from "./projects.ts";

/**
 * Lore-side overlay table on top of the framework `files` entity (see
 * `alepha/api/files`). The framework owns the bytes + framework
 * metadata (size, mime, checksum/sha256, originalName, tags); Lore
 * owns the project-scoping + folio tree position.
 *
 * `fileId` is both the PK and the FK back to `files`. One folio_blob
 * row per file, one file per folio_blob row. Cascade-delete in both
 * directions — wiping the framework file row wipes the overlay; wiping
 * the project wipes both.
 *
 * `directoryId` NULL means "lives at the project root". Name + parent
 * uniqueness is enforced via the `folio_names` reservation table
 * (shared with folios and directories so a folio and a blob can't have
 * the same name in the same folder).
 */
export const folioBlobs = $entity({
  name: "folio_blobs",
  schema: z.object({
    fileId: db.primaryKey(z.uuid()),
    /** Per-project sequential id. URL form is `blob:#42`. */
    shortId: z.integer().min(1),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    directoryId: db.ref(z.uuid().optional(), () => folioDirectories.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Display name within the folio tree. Mirrors `files.name` at
     * write time, but the Folio UI lets users rename — and the
     * uniqueness reservation lives on this column, not on the
     * framework's `files.name`. The framework's `files.originalName`
     * preserves the as-uploaded filename.
     */
    name: z.string().min(1).max(200),
  }),
  indexes: [
    { columns: ["projectId", "shortId"], unique: true },
    { columns: ["directoryId"] },
  ],
});

export type FolioBlob = Infer<typeof folioBlobs.schema>;
