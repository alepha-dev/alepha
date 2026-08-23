import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { projects } from "./projects.ts";

/**
 * Directory node in the per-project folio tree (folios + blobs +
 * directories under one roof, gdrive-style). `parent_id = null` is the
 * project root. Cycle prevention is enforced at the service layer on
 * every reparent (same pattern the old folio-tree from #45 used).
 *
 * Quest [[#66]] introduces this table; folios + blobs hang off it via
 * their own `directoryId` FK columns. Names are unique per-parent
 * across all three node types — enforced via the `folio_names`
 * reservation table (separate file), so this entity stays simple.
 */
export const folioDirectories = $entity({
  name: "folio_directories",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    /**
     * Per-project sequential id, 1-based. Powers the human-readable
     * `/:projectSlug/folios/d/:shortId` URL and the MCP shortId form.
     * Allocated by `$sequence(scope=projectId)` on insert.
     */
    shortId: z.integer().min(1),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Parent directory. `undefined` means "project root". Cascade-delete
     * on parent removal — wiping a directory wipes everything underneath
     * (including blobs and folios via their own CASCADE refs to this
     * table). Cycle prevention is service-side; the schema doesn't
     * enforce it.
     */
    parentId: db.ref(z.uuid().optional(), () => folioDirectories.cols.id, {
      onDelete: "cascade",
    }),
    name: z.string().min(1).max(200),
  }),
  indexes: [
    { columns: ["projectId", "shortId"], unique: true },
    { columns: ["parentId"] },
  ],
});

export type FolioDirectory = Infer<typeof folioDirectories.schema>;
