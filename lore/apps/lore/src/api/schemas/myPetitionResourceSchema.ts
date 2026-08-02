import { type Infer, z } from "alepha";
import { petitionResourceSchema } from "./petitionResourceSchema.ts";

/**
 * A petition as seen by its reporter on the `/me` profile page.
 *
 * Extends {@link petitionResourceSchema} with the owning `campaign` (title +
 * icon) so the cross-campaign list can show which campaign each petition
 * belongs to without a per-row lookup.
 */
export const myPetitionResourceSchema = petitionResourceSchema.extend({
  campaign: z.object({
    id: z.integer(),
    title: z.string(),
    icon: z.union([z.uuid(), z.null()]).optional(),
  }),
});

export type MyPetitionResource = Infer<typeof myPetitionResourceSchema>;
