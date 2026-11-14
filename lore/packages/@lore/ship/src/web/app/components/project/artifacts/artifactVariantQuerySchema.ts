import { z } from "alepha";

/**
 * Which variant of the tag the page shows, as `?variant=<runtime>-<format>`.
 *
 * Beside `?tab=`, which `useDetailTab` owns. Both writers merge into the
 * current query, so neither clears the other.
 */
export const artifactVariantQuerySchema = z.object({
  variant: z.string().optional(),
});
