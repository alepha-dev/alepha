import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { folioDirectories } from "./folioDirectories.ts";
import { folios } from "./folios.ts";
import { projects } from "./projects.ts";

/**
 * Lore-side overlay table on top of the framework `files` entity (see
 * `alepha/api/files`). The framework owns the bytes + framework
 * metadata (size, mime, checksum/sha256, originalName, tags); Lore
 * owns the project-scoping + folio tree position.
 *
 * `fileId` is the PK, and a LOGICAL reference back to `files.id` - one
 * folio_blob row per file, one file per folio_blob row. There is no
 * physical foreign key and no cascade between the two: this file used to
 * claim both, and the claim was the bug. Deleting a framework file left
 * the overlay row behind, and deleting a folio cascaded the overlay rows
 * away while the files and their bytes stayed in the bucket forever.
 *
 * Adding the constraint means a table rebuild, and a rebuild on D1 is the
 * cascade-wipe this app has already been bitten by once - see "Migration
 * safety on D1" in `apps/lore/CLAUDE.md`. `FolioAttachmentService.delete` and
 * `FolioAttachmentService.deleteByFolio` are the enforcement instead, and are
 * the only two ways an attachment may be removed.
 *
 * `projectId` and `folioId` below ARE physical and DO cascade: wiping the
 * project or the folio wipes the overlay rows. That is what makes
 * `deleteByFolio` have to run first.
 *
 * An attachment belongs to exactly ONE folio and dies with it. It used
 * to sit in the folio tree beside folios and directories, scoped by
 * `directoryId`; that made a attachment a peer of the documents rather than
 * part of one, and left an uploaded image reachable from a folder it
 * had nothing to do with.
 *
 * Consequently the name only has to be unique **within its folio**, so
 * attachments no longer participate in the `folio_names` reservation table —
 * that table exists to stop a folio and a directory colliding in one
 * folder, which a per-folio attachment cannot do. `FolioAttachmentService`
 * auto-suffixes against its siblings directly.
 */
export const folioAttachments = $entity({
  name: "folio_blobs",
  schema: z.object({
    fileId: db.primaryKey(z.uuid()),
    /**
     * Per-project sequential id: the `#42` the Attachments tab and the
     * `folio_attachment_*` MCP tools address an attachment by.
     */
    shortId: z.integer().min(1),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The folio this attachment belongs to. Required — an attachment
     * with no folio has nowhere to be shown and nothing to be exported
     * with. Cascades, so deleting a folio takes its attachments.
     *
     * Declared required here but physically NULLABLE: SQLite will not
     * add a `NOT NULL` column that carries a `REFERENCES` clause at any
     * table size, and the only shape that would is a table rebuild —
     * which on D1 cascade-wipes this table's children. Same accepted
     * drift as `sigils.name`. `FolioAttachmentService.register` is the real
     * enforcement.
     */
    folioId: db.ref(z.uuid(), () => folios.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * @deprecated Dead column — nothing reads or writes it since
     * attachments became folio-scoped.
     *
     * It survives because SQLite cannot drop a column that carries a
     * foreign key, and removing the FK means rebuilding the table —
     * which is the D1 cascade-wipe hazard this file's other comments
     * describe. Kept declared so the snapshot matches what is
     * physically on disk, exactly as `projects.public` and
     * `projects.unlockedFeatures` are.
     */
    directoryId: db.ref(z.uuid().optional(), () => folioDirectories.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Display name, unique within the owning folio. Mirrors `files.name`
     * at write time, but the Folio UI lets users rename it — and the
     * markdown refers to the attachment by this name (`assets/<name>`),
     * not by id. The framework's `files.originalName` preserves the
     * as-uploaded filename.
     */
    name: z.string().min(1).max(200),
  }),
  indexes: [
    { columns: ["projectId", "shortId"], unique: true },
    { columns: ["folioId"] },
  ],
});

export type FolioAttachment = Infer<typeof folioAttachments.schema>;
