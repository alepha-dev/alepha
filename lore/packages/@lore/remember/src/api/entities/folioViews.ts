import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { folios } from "./folios.ts";

/**
 * How a table folio is read (#E144, #Q3518): the view open last (`grid` or
 * `calendar`), the date column the calendar lays rows out by, and the
 * column that titles an entry.
 *
 * A fact about the folio, not about a reader: every reader and the
 * dashboard's Folio card share it. One row per table folio at most, written
 * the first time someone switches the view.
 *
 * Read leniently (`FolioTableService.viewOf`): a column id that no longer
 * exists falls back to the first date column, then to the grid. The values
 * are plain strings for the same reason, never an enum a stale value could
 * fail on.
 *
 * Its own table rather than a column on `folios`, which this epic changes by
 * `type` only. A cascade leaf of `folios`.
 */
export const folioViews = $entity({
  name: "folio_views",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    updatedAt: db.updatedAt(),
    folioId: db.ref(z.uuid(), () => folios.cols.id, {
      onDelete: "cascade",
    }),
    kind: z.string().max(20),
    dateColumnId: z.string().max(40).optional(),
    titleColumnId: z.string().max(40).optional(),
  }),
  indexes: [{ columns: ["folioId"], unique: true }],
});

export type FolioView = Infer<typeof folioViews.schema>;
