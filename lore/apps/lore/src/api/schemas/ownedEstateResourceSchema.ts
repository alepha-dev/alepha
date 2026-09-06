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
 * What the machine last reported, in two numbers.
 *
 * The whole point of the denormalised `appCount`: the list says "7 apps,
 * reported 4 minutes ago" without deserializing any host's app array and
 * without waking a machine. Absent for one that has never connected.
 */
export const estateInventorySummarySchema = z.object({
  appCount: z.integer().min(0),
  reportedAt: z.string().max(40),
});

export type EstateInventorySummary = Infer<typeof estateInventorySummarySchema>;

/**
 * An estate as its owner lists it: the resource plus the projects it is
 * lent to (#1838), and what the machine last reported.
 *
 * The loans are the one fact about an estate the owner's page needs that the
 * row does not hold. Resolved for the whole list in two queries rather than
 * one per row, in `EstateService.withLoans`; the inventory summary is one
 * more `inArray` in the same method, for the same reason.
 */
export const ownedEstateResourceSchema = estateResourceSchema.extend({
  projects: z.array(estateLoanSchema),
  inventory: estateInventorySummarySchema.optional(),
});

export type OwnedEstateResource = Infer<typeof ownedEstateResourceSchema>;
