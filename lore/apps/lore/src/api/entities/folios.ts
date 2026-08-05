import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { folioDirectories } from "./folioDirectories.ts";
import { projects } from "./projects.ts";

export const folios = $entity({
  name: "folios",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    /**
     * Per-project sequential id, 1-based. Used in URLs
     * (`/p/:projectId/folios/:shortId`) and UI display. Allocated by
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
     * 1-2 sentence agent-readable summary (~200 chars). Filled by MCP tools
     * (`folio_create` / `folio_update`) so `project_context` can return a
     * meaningful index without forcing agents to `folio_get` every entry.
     * Web users may leave it empty — `project_context` then falls back to
     * the title.
     */
    summary: db.default(z.string().max(500), ""),
    /**
     * Lowercased concatenation of `title + " " + tags + " " + summary + " " + content`.
     * Populated on every create/update for cheap `LIKE` search on D1/SQLite.
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
 * Keep title/tags/summary/content all in one column so a single `LIKE %q%`
 * works. Existing rows have `summary = ""` (default) so the formula is a
 * superset of the pre-summary formula — no backfill is required.
 */
export const buildFolioSearchText = (input: {
  title: string;
  tags?: string[];
  summary?: string;
  content?: string;
}): string =>
  [
    input.title,
    (input.tags ?? []).join(" "),
    input.summary ?? "",
    input.content ?? "",
  ]
    .join(" ")
    .toLowerCase();
