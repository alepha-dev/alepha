import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";

import { folios } from "./folios.ts";

/**
 * The rows of a table folio (#E144, #Q3511): one record each, so two writers
 * on two rows never collide on the folio's single version.
 *
 * A cascade child of `folios`, and a leaf: nothing references a row.
 */
export const folioRows = $entity({
  name: "folio_rows",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    folioId: db.ref(z.uuid(), () => folios.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Per-folio, 1-based, what an agent names ("row 12"). Allocated by the
     * `folioRowNumber` sequence scoped to the folio, and never reused: a
     * deleted row's number stays burnt, and so does one a revert takes back.
     */
    number: z.integer().min(1),
    /**
     * Top to bottom. A real number, so a row inserted or moved between two
     * others takes the midpoint and no other row is rewritten.
     */
    position: z.number(),
    /**
     * Optimistic lock: a write names the version it read, and a stale one
     * answers 409.
     */
    version: db.version(),
    /**
     * The cells, keyed by column id. Values are stored as written after
     * coercion (`FolioTableService.coerce`), and read leniently: a value that
     * no longer fits its column reads as empty, and a key whose column was
     * removed is ignored and dropped by the row's next write.
     */
    cells: db.default(z.record(z.text(), z.any()), {}),
    /**
     * Lowercased text of the cells, for search: a select by its label, a
     * reference by its code (`#Q12`), a checkbox not at all.
     */
    searchText: db.default(z.string(), ""),
    updatedByUserId: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
  }),
  indexes: [
    { columns: ["folioId", "position"] },
    { columns: ["folioId", "number"], unique: true },
  ],
});

export type FolioRowRecord = Infer<typeof folioRows.schema>;
