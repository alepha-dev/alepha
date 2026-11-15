import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { folios } from "./folios.ts";

/**
 * The typed columns of a table folio (#E144, #Q3511).
 *
 * A table folio's `content` stays empty: its data is the rows of
 * `folio_rows`, whose `cells` are keyed by the ids of these columns. The
 * column set is small (50 at most, `FolioTableService.MAX_COLUMNS`), so the
 * service reads all of a folio's columns at once and never pages them.
 *
 * A cascade child of `folios`, and a leaf: nothing references a column.
 */
export const folioColumns = $entity({
  name: "folio_columns",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    folioId: db.ref(z.uuid(), () => folios.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Left to right. Rewritten for every column of the folio when one moves:
     * there are at most 50.
     */
    position: z.integer(),
    name: z.string().min(1).max(80),
    /**
     * `LOWER(name)`: a column name is unique within its folio without regard
     * to case, and the unique index below is what refuses the second.
     */
    lowerName: z.string().max(80),
    /**
     * `text`, `number`, `checkbox`, `date`, `select` or `reference`.
     *
     * A plain string, not an enum, on purpose: a stored value outside an
     * enum fails the whole row on read (the 2026-08-05 class), and a column
     * whose type this build does not know must still read, as `text`
     * (`FolioTableService.typeOf`).
     */
    type: z.string().max(20),
    /**
     * The column's settings: a select's `choices` (`{ id, label }`), and
     * `withTime` for a date. Read through `FolioTableService.optionsOf`,
     * which ignores anything it does not recognise.
     */
    options: db.default(z.record(z.text(), z.any()), {}),
  }),
  indexes: [
    { columns: ["folioId", "position"] },
    { columns: ["folioId", "lowerName"], unique: true },
  ],
});

export type FolioColumn = Infer<typeof folioColumns.schema>;
