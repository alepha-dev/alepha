import { $atom, z } from "alepha";
import { devMetadataSchema } from "alepha/inspector";

/**
 * The one copy of the selected run's metadata the UI keeps, with the run it
 * belongs to.
 *
 * The payload embeds every action schema plus three schemas per entity, so it
 * is far too heavy to refetch per screen: before this atom existed seven
 * components each fetched it independently, including the layout, which wanted
 * a single entity count. Screens read it through `useMetadata`, which
 * refetches when the selected run is no longer the one it holds.
 */
export const devMetadataAtom = $atom({
  name: "devtools.metadata",
  schema: z
    .object({
      runId: z.text(),
      metadata: devMetadataSchema,
    })
    .optional(),
});
