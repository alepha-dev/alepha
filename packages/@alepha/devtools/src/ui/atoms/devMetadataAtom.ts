import { $atom } from "alepha";
import { devMetadataSchema } from "../../schemas/DevMetadata.ts";

/**
 * The one copy of `/__devtools/api/metadata` the UI keeps.
 *
 * The payload embeds every action schema plus three schemas per entity, so it
 * is far too heavy to refetch per screen — before this atom existed seven
 * components each fetched it independently, including the layout, which wanted
 * a single entity count. Screens read it through `useMetadata`.
 */
export const devMetadataAtom = $atom({
  name: "devtools.metadata",
  schema: devMetadataSchema.optional(),
});
