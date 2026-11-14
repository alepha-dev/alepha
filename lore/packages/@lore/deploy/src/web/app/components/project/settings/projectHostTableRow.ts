import type { LentEstateResource } from "../../../../../api/controllers/ProjectEstateController.ts";
import type { OwnedEstateResource } from "../../../../../api/schemas/ownedEstateResourceSchema.ts";

/**
 * One row of the project's estates table (#Q3409): an estate the project is
 * the home of, or one another project lends it.
 *
 * `origin` is the flag the table filters on, a plain field so the static
 * table's own matching reads it. A home estate carries `owned`, and `loan`
 * too when it is also lent to its home, which is what lets the project
 * deploy onto it; a borrowed one carries `loan` alone.
 */
export interface ProjectEstateTableRow {
  id: string;
  slug: string;
  origin: "home" | "lent";
  owned?: OwnedEstateResource;
  loan?: LentEstateResource;
}
