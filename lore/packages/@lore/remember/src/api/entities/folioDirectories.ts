import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * Directory node in the per-project folio tree (folios + attachments +
 * directories under one roof, gdrive-style). `parent_id = null` is the
 * project root. Cycle prevention is enforced at the service layer on
 * every reparent (same pattern the old folio-tree from #45 used).
 *
 * Quest #Q66 introduces this table; folios + attachments hang off it via
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
     * (including attachments and folios via their own CASCADE refs to this
     * table). Cycle prevention is service-side; the schema doesn't
     * enforce it.
     */
    parentId: db.ref(z.uuid().optional(), () => folioDirectories.cols.id, {
      onDelete: "cascade",
    }),
    name: z.string().min(1).max(200),
    /**
     * A directory Lore owns (#Q3659). `trash` is the project's one trash:
     * always present, never renamed, moved or deleted, and anything put in
     * it is deleted for good 30 days later. Absent for every directory a
     * person made.
     */
    system: z.enum(["trash"]).meta({ mode: "text" }).optional(),
    /**
     * When this directory was moved into the trash (#Q3659); cleared when it
     * is moved out. The purge reads it.
     */
    trashedAt: z.datetime().optional(),
  }),
  indexes: [
    { columns: ["projectId", "shortId"], unique: true },
    { columns: ["parentId"] },
    { columns: ["projectId", "system"] },
  ],
});

export type FolioDirectory = Infer<typeof folioDirectories.schema>;
