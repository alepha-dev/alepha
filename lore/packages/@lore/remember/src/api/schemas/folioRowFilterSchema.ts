import { type Infer, z } from "alepha";

/**
 * One condition on a table's rows. `column` is an id, or a name without
 * regard to case. Set one operator: `equals`, `contains` (text, without
 * regard to case), `isEmpty`, or a range `from` / `to` (inclusive) on a date
 * or number column. A day bound (`YYYY-MM-DD`) compares by day.
 */
export const folioRowFilterSchema = z.object({
  column: z.string(),
  equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
  contains: z.string().optional(),
  isEmpty: z.boolean().optional(),
  from: z.union([z.string(), z.number()]).optional(),
  to: z.union([z.string(), z.number()]).optional(),
});

export type FolioRowFilter = Infer<typeof folioRowFilterSchema>;
