import { type Infer, z } from "alepha";

/**
 * How a table folio is read, resolved against its columns (#Q3518): the
 * view, the date column a calendar lays rows out by, and the column that
 * titles an entry. `dateColumnId` is absent when the table has no date
 * column, and the view is then always the grid.
 */
export const folioTableViewSchema = z.object({
  kind: z.enum(["grid", "calendar"]),
  dateColumnId: z.string().optional(),
  titleColumnId: z.string().optional(),
});

export type FolioTableView = Infer<typeof folioTableViewSchema>;
