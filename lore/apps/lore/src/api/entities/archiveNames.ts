import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * Reservation table that enforces "no two siblings with the same name"
 * across all three Archive node types (folios, blobs, directories).
 * Every create/rename/move writes the entity row AND a reservation row
 * in one transaction; the UNIQUE INDEX is what makes the DB reject
 * collisions atomically without app-side locking.
 *
 * Scope key. SQLite considers multiple `NULL`s distinct in a UNIQUE
 * index, so using `parent_directory_id = NULL` for root-level entries
 * wouldn't catch collisions. To work around that:
 * - non-root entries set `parentDirectoryId` to the parent's UUID and
 *   leave `rootScope` undefined.
 * - root entries set `parentDirectoryId` to a sentinel string
 *   `root:<campaignId>` (computed by `ArchiveNameService.dbParentId`)
 *   AND set `rootScope = String(campaignId)`. The redundant `rootScope`
 *   column is kept so the index signature reads naturally and so a
 *   future migration can promote it to first-class scope key if the
 *   sentinel-string shape proves brittle.
 *
 * Not a foreign key — `kind` discriminates which entity table
 * `entityId` lives in. The reservation row is kept in sync via
 * `ArchiveNameService.reserve` / `releaseByEntity`; on cascade-delete
 * of a parent directory, the service walks the subtree to release
 * reservations before the FK cascade fires (see
 * `ArchiveDirectoryService.delete`).
 */
export const archiveNames = $entity({
  name: "archive_names",
  schema: z.object({
    /**
     * Synthetic UUID PK. Not referenced by any other table — exists
     * purely so `Repository.deleteMany` (which `.returning({id})`s)
     * works. Without it, every release path (`releaseByEntity` from
     * rename/move/delete) threw `AlephaError("Primary key not found in
     * schema")` re-wrapped as a generic `DbError("Delete query has
     * failed")`. Inserts worked because `create()` uses
     * `.returning(this.table)` instead.
     */
    id: db.primaryKey(z.uuid()),
    /**
     * Parent scope key. The parent directory's UUID for non-root
     * entries; the `root:<campaignId>` sentinel for root entries.
     */
    parentDirectoryId: z.string().optional(),
    /**
     * Mirror of `parentDirectoryId` for root entries — `String(campaignId)`.
     * Undefined for non-root entries. See entity docstring.
     */
    rootScope: z.string().optional(),
    /** `LOWER(name)` — case-insensitive uniqueness key. */
    lowerName: z.string(),
    /** Discriminator for the entity table `entityId` lives in. */
    kind: z.enum(["folio", "blob", "directory"]).meta({ mode: "text" }),
    entityId: z.string(),
  }),
  indexes: [
    // Composite uniqueness — Drizzle composite-PK shape on optional
    // columns is awkward, so we use a UNIQUE INDEX instead.
    {
      columns: ["parentDirectoryId", "rootScope", "lowerName"],
      unique: true,
    },
    // Reverse lookup — drop the row by entityId when an entity is
    // deleted or renamed.
    { columns: ["entityId"] },
  ],
});

export type ArchiveName = Static<typeof archiveNames.schema>;
