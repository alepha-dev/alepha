import { z } from "alepha";

/**
 * Paging, sorting and filtering, as `AlephaTable` sends them.
 *
 * Everything is optional: the table omits a filter key entirely rather than
 * sending it empty, which is also what the repository API requires.
 */
export const showcaseMemberQuerySchema = z.object({
  page: z.integer().optional(),
  size: z.integer().optional(),
  sort: z.text().optional(),
  search: z.text().optional(),
  status: z.text().optional(),
});
