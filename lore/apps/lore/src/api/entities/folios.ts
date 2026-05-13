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
    content: db.default(t.string(), ""),
    tags: db.default(t.array(t.string()), []),
    /**
     * Lowercased concatenation of `title + " " + tags + " " + content`.
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
 * Keep title/tags/content all in one column so a single `LIKE %q%` works.
 */
export const buildFolioSearchText = (input: {
  title: string;
  tags?: string[];
  content?: string;
}): string =>
  [input.title, (input.tags ?? []).join(" "), input.content ?? ""]
    .join(" ")
    .toLowerCase();
