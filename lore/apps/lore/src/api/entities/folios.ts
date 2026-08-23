import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { epics } from "./epics.ts";
import { folioDirectories } from "./folioDirectories.ts";
import { projects } from "./projects.ts";

export const folios = $entity({
  name: "folios",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    /**
     * Per-project sequential id, 1-based. Used in URLs
     * (`/:projectSlug/folios/:shortId`) and UI display. Allocated by
     * `$sequence(scope=projectId)` on insert. The global UUID `id` remains
     * the canonical PK.
     */
    shortId: z.integer().min(1),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    title: z.string().min(1).max(200),
    /**
     * When `true` the folio's `content` field is a passphrase-encrypted
     * JSON envelope produced client-side by `BrowserCryptoProvider`. The
     * server stores the ciphertext as opaque text — it never sees the
     * passphrase or the plaintext. `searchText` stays empty in that
     * mode (ciphertext is not indexable) and the editor takes a
     * different path to render / save.
     */
    protected: db.default(z.boolean(), false),
    content: db.default(z.string(), ""),
    /**
     * @deprecated Dead column. The tag feature was removed (feedback #62)
     * — nothing reads or writes this, and no UI or MCP surface exposes it.
     *
     * **It stays declared on purpose.** Dropping a column from SQLite means
     * a table rebuild, and `folios` is the `ON DELETE CASCADE` parent of
     * `folio_links`, `folio_revisions` and `folio_blobs` — D1 ignores
     * `PRAGMA foreign_keys=OFF`, so the rebuild's `DROP TABLE` would
     * cascade-wipe all three in production. Same verdict, same reasoning as
     * `projects.unlockedFeatures` / `projects.public`. See "Migration safety
     * on D1" in apps/lore/CLAUDE.md.
     */
    tags: db.default(z.array(z.string()), []),
    /**
     * Pin a folio so it sorts to the top of the project's folio list AND
     * (when not protected) has its full content surfaced by
     * `project_context` — the per-project equivalent of CLAUDE.md.
     * Per-project (one shared pin set per project, since folios are
     * project-shared since quest #65). Default false.
     */
    pinned: db.default(z.boolean(), false),
    /**
     * Folio directory the folio lives in. `undefined` means "project
     * root". Replaces the old self-FK `parentId` from quest #45 — folios
     * no longer nest under other folios; they sit in directories instead
     * (quest #66 - Folio module). Cascade-delete on directory removal:
     * wiping a directory wipes everything in it, including its folios.
     */
    directoryId: db.ref(z.uuid().optional(), () => folioDirectories.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Optional owning epic. `SET NULL` on delete: removing an epic orphans
     * its folios, it never deletes them.
     *
     * ⚠️ Declared optional with NO `db.default(...)` so the migration is a
     * plain additive `ALTER TABLE ADD COLUMN`. A column DEFAULT triggers a
     * table rebuild on D1 — worse here than on `quests`, since `folios` is
     * the CASCADE parent of `folio_revisions` / `folio_links` /
     * `folio_blobs`.
     */
    epicId: db.ref(z.integer().optional(), () => epics.cols.id, {
      onDelete: "set null",
    }),
    /**
     * 1-2 sentence agent-readable summary (~200 chars). Filled by MCP tools
     * (`folio_create` / `folio_update`) so `project_context` can return a
     * meaningful index without forcing agents to `folio_get` every entry.
     * Web users may leave it empty — `project_context` then falls back to
     * the title.
     */
    summary: db.default(z.string().max(500), ""),
    /**
     * Lowercased concatenation of `title + " " + summary + " " + content`.
     * Populated on every create/update for cheap `LIKE` search on D1/SQLite.
     *
     * Rows written before the tag feature was removed still carry their tag
     * words in here until their next save. Search stays a superset, so this
     * is left to age out rather than backfilled with an `UPDATE` over every
     * row in production.
     */
    searchText: db.default(z.string(), ""),
  }),
  indexes: [
    { columns: ["projectId", "updatedAt"] },
    { columns: ["projectId", "title"] },
    { columns: ["projectId", "shortId"], unique: true },
  ],
});

export type Folio = Infer<typeof folios.schema>;

/**
 * Build the lowercase search blob from a folio's user-editable fields.
 * Keep title/summary/content all in one column so a single `LIKE %q%`
 * works.
 */
export const buildFolioSearchText = (input: {
  title: string;
  summary?: string;
  content?: string;
}): string =>
  [input.title, input.summary ?? "", input.content ?? ""]
    .join(" ")
    .toLowerCase();
