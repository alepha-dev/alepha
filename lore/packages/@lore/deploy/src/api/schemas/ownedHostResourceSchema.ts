import { type Infer, z } from "alepha";

import { hostResourceSchema } from "./hostResourceSchema.ts";

/**
 * A project a host is lent to, as the owner's page names it: enough to
 * link there and nothing of what is inside it.
 */
export const hostLoanSchema = z.object({
  id: z.integer(),
  title: z.string(),
  slug: z.string().optional(),
  lentAt: z.string(),
});

export type HostLoan = Infer<typeof hostLoanSchema>;

/**
 * What the machine last reported, in two numbers.
 *
 * The whole point of the denormalised `appCount`: the list says "7 apps,
 * reported 4 minutes ago" without deserializing any host's app array and
 * without waking a machine. Absent for one that has never connected.
 */
export const hostInventorySummarySchema = z.object({
  appCount: z.integer().min(0),
  reportedAt: z.string().max(40),
});

export type HostInventorySummary = Infer<typeof hostInventorySummarySchema>;

/**
 * A host as a member of its home project lists it: the resource plus the projects it is
 * lent to (#1838), and what the machine last reported.
 *
 * The loans are the one fact about a host the owner's page needs that the
 * row does not hold. Resolved for the whole list in two queries rather than
 * one per row, in `HostService.withLoans`; the inventory summary is one
 * more `inArray` in the same method, for the same reason.
 */
export const ownedHostResourceSchema = hostResourceSchema.extend({
  projects: z.array(hostLoanSchema),
  inventory: hostInventorySummarySchema.optional(),
});

export type OwnedHostResource = Infer<typeof ownedHostResourceSchema>;
