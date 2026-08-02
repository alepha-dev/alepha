import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";

/**
 * Directory node in the per-campaign Archive tree (folios + blobs +
 * directories under one roof, gdrive-style). `parent_id = null` is the
 * campaign root. Cycle prevention is enforced at the service layer on
 * every reparent (same pattern the old folio-tree from #45 used).
 *
 * Quest [[#66]] introduces this table; folios + blobs hang off it via
 * their own `directoryId` FK columns. Names are unique per-parent
 * across all three node types — enforced via the `archive_names`
 * reservation table (separate file), so this entity stays simple.
 */
export const archiveDirectories = $entity({
  name: "archive_directories",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    /**
     * Per-campaign sequential id, 1-based. Powers the human-readable
     * `/c/:campaignId/archive/d/:shortId` URL and the MCP shortId form.
     * Allocated by `$sequence(scope=campaignId)` on insert.
     */
    shortId: z.integer().min(1),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    campaignId: db.ref(z.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Parent directory. `undefined` means "campaign root". Cascade-delete
     * on parent removal — wiping a directory wipes everything underneath
     * (including blobs and folios via their own CASCADE refs to this
     * table). Cycle prevention is service-side; the schema doesn't
     * enforce it.
     */
    parentId: db.ref(z.uuid().optional(), () => archiveDirectories.cols.id, {
      onDelete: "cascade",
    }),
    name: z.string().min(1).max(200),
  }),
  indexes: [
    { columns: ["campaignId", "shortId"], unique: true },
    { columns: ["parentId"] },
  ],
});

export type ArchiveDirectory = Infer<typeof archiveDirectories.schema>;
