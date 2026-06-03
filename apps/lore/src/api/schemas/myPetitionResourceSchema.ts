import { type Static, t } from "alepha";
import { petitionResourceSchema } from "./petitionResourceSchema.ts";

/**
 * A petition as seen by its reporter on the `/me` profile page.
 *
 * Extends {@link petitionResourceSchema} with the owning `campaign` (title +
 * icon) so the cross-campaign list can show which campaign each petition
 * belongs to without a per-row lookup.
 */
export const myPetitionResourceSchema = t.extend(petitionResourceSchema, {
  campaign: t.object({
    id: t.integer(),
    title: t.string(),
    icon: t.optional(t.union([t.uuid(), t.null()])),
  }),
});

export type MyPetitionResource = Static<typeof myPetitionResourceSchema>;
