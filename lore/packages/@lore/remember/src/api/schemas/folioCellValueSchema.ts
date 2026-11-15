import { type Infer, z } from "alepha";

/**
 * One cell of a table folio as it is read: text, a number, a checkbox, a
 * date (`YYYY-MM-DD`, or an ISO datetime in UTC), a select's option id, a
 * reference's code (`#Q12`), or `null` when empty.
 */
export const folioCellValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export type FolioCellValue = Infer<typeof folioCellValueSchema>;
