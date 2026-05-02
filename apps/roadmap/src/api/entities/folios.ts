import { type Static, t } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

export const folios = $entity({
  name: "folios",
  schema: t.object({
    id: db.primaryKey(t.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    userId: db.ref(t.uuid(), () => users.cols.id, { onDelete: "cascade" }),
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
