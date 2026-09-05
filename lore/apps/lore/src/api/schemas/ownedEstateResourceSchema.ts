import { type Infer, z } from "alepha";

import { estateResourceSchema } from "./estateResourceSchema.ts";

/**
 * A project an estate is lent to, as the owner's page names it: enough to
 * link there and nothing of what is inside it.
 */
export const estateLoanSchema = z.object({
  id: z.integer(),
  title: z.string(),
  slug: z.string().optional(),
  lentAt: z.string(),
});

export type EstateLoan = Infer<typeof estateLoanSchema>;

/**
 * An estate as its owner lists it: the resource plus the projects it is
 * lent to (#1838).
 *
 * The loans are the one fact about an estate the owner's page needs that the
 * row does not hold. Resolved for the whole list in two queries rather than
 * one per row, in `EstateService.withLoans`.
 */
export const ownedEstateResourceSchema = estateResourceSchema.extend({
  projects: z.array(estateLoanSchema),
});

export type OwnedEstateResource = Infer<typeof ownedEstateResourceSchema>;
