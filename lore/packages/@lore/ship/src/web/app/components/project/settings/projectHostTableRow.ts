import type { LentHostResource } from "../../../../../api/controllers/ProjectHostController.ts";
import type { OwnedHostResource } from "../../../../../api/schemas/ownedHostResourceSchema.ts";

/**
 * One row of the project's hosts table (#Q3409): a host the project is
 * the home of, or one another project lends it.
 *
 * `origin` is the flag the table filters on, a plain field so the static
 * table's own matching reads it. A home host carries `owned`, and `loan`
 * too when it is also lent to its home, which is what lets the project
 * deploy onto it; a borrowed one carries `loan` alone.
 */
export interface ProjectHostTableRow {
  id: string;
  slug: string;
  origin: "home" | "lent";
  owned?: OwnedHostResource;
  loan?: LentHostResource;
}
