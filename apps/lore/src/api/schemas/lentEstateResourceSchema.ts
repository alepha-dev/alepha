import { type Infer, z } from "alepha";

import { ESTATE_TYPES } from "../entities/estates.ts";

/**
 * An estate as a project's members see it: enough to pick it as a deploy
 * destination and to see whether the machine behind it is up, and nothing
 * that belongs to its owner alone.
 *
 * No `secretPrefix`, no switches beyond `deployAllowed` (which decides
 * whether the project can deploy through it at all), and the owner named the
 * way the rest of the app names people, because two owners may both have an
 * estate called `ovh-1` and a member has to tell them apart.
 *
 * Built by hand rather than derived from the entity on purpose: a field
 * added to `estates` must be a decision to show here, not a default.
 */
export const lentEstateResourceSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  label: z.string().optional(),
  type: z.enum(ESTATE_TYPES),
  online: z.boolean(),
  deployAllowed: z.boolean(),
  acceptedRuntimes: z.array(z.string()),
  lastSeenAt: z.string().optional(),
  cpuPercent: z.number().optional(),
  memoryPercent: z.number().optional(),
  owner: z.object({ id: z.uuid(), name: z.string() }),
  lentAt: z.string(),
});

export type LentEstateResource = Infer<typeof lentEstateResourceSchema>;

/**
 * A lent estate plus the one cleartext copy of a secret Lore minted, if it
 * minted one, for the create-from-inside-a-project flow.
 *
 * Same rule as `mintedEstateSchema`, including the optionality: nothing can
 * produce the secret again, and a cloudflare create produces none at all, so
 * the field is **absent** rather than empty.
 */
export const mintedLentEstateSchema = lentEstateResourceSchema.extend({
  secret: z.string().optional(),
});

export type MintedLentEstate = Infer<typeof mintedLentEstateSchema>;
