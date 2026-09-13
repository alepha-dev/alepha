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
  /**
   * How `status` compares. Absent means `is`: a filter on its default
   * operator sends no key, which keeps plain links plain.
   */
  statusOp: z.enum(["is", "not"]).optional(),
  team: z.text().optional(),
  /** Comma-joined list - see the fetcher for why it is not an array. */
  roles: z.text().optional(),
  /**
   * Absent means `any`. There is no `all`: a member has one role, so "all of
   * Owner and Viewer" matches nobody.
   */
  rolesOp: z.enum(["any", "none"]).optional(),
  /** Comma-joined, like `roles`. */
  tags: z.text().optional(),
  /**
   * Absent means `any`. `all` exists here and not on `roles` because a
   * member carries several tags.
   */
  tagsOp: z.enum(["any", "all", "none"]).optional(),
  email: z.text().optional(),
});
