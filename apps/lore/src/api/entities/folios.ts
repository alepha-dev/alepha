import { type Static, t } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";
import { campaigns } from "./campaigns.ts";

export const folios = $entity({
  name: "folios",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    /**
     * Per-campaign sequential id, 1-based. Used in URLs
     * (`/c/:campaignId/folios/:shortId`) and UI display. Allocated by
     * `$sequence(scope=campaignId)` on insert. The global UUID `id` remains
     * the canonical PK.
     */
    shortId: t.integer({ minimum: 1 }),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    userId: db.ref(t.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    campaignId: db.ref(t.integer(), () => campaigns.cols.id, {
      onDelete: "cascade",
    }),
    title: t.string({ minLength: 1, maxLength: 200 }),
    /**
     * When `true` the folio's `content` field is a passphrase-encrypted
     * JSON envelope produced client-side by `BrowserCryptoProvider`. The
     * server stores the ciphertext as opaque text — it never sees the
     * passphrase or the plaintext. `searchText` stays empty in that
     * mode (ciphertext is not indexable) and the editor takes a
     * different path to render / save.
     */
    protected: db.default(t.boolean(), false),
    content: db.default(t.string(), ""),
    tags: db.default(t.array(t.string()), []),
    /**
     * Adjacency-list pointer to another folio (same user, same campaign)
     * that acts as this folio's parent in the sidebar tree. `undefined`
     * means root level. Cycles are rejected at update time. On parent
     * deletion the FK is set to NULL — orphans float back up to the root
     * rather than getting destroyed.
     */
    parentId: db.ref(t.optional(t.uuid()), () => folios.cols.id, {
      onDelete: "set null",
    }),
    /**
     * 1-2 sentence agent-readable summary (~200 chars). Filled by MCP tools
     * (`folio_create` / `folio_update`) so `campaign_context` can return a
     * meaningful index without forcing agents to `folio_get` every entry.
     * Web users may leave it empty — `campaign_context` then falls back to
     * the title.
     */
    summary: db.default(t.string({ maxLength: 500 }), ""),
    /**
     * Lowercased concatenation of `title + " " + tags + " " + summary + " " + content`.
     * Populated on every create/update for cheap `LIKE` search on D1/SQLite.
     */
    searchText: db.default(t.string(), ""),
  }),
  indexes: [
    { columns: ["userId", "updatedAt"] },
    { columns: ["userId", "title"] },
    { columns: ["campaignId", "userId", "updatedAt"] },
    { columns: ["campaignId", "shortId"], unique: true },
  ],
});

export type Folio = Static<typeof folios.schema>;

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
