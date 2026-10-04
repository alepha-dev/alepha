import { type Infer, z } from "alepha";

/**
 * Discriminant carried by the synthetic entry devtools writes when it restores
 * a previous session's logs.
 *
 * Structural rather than textual on purpose. The UI renders this entry as a
 * divider between two runs, and matching on the message would let any
 * application that happens to log the same words masquerade as a restart.
 * Namespaced the same way `db:query` is, since the log viewer already
 * discriminates entry kinds off `data.type`.
 */
export const DEV_LOG_RESTART_TYPE = "devtools:restart";

export const devLogRestartMarkerSchema = z.object({
  type: z.literal(DEV_LOG_RESTART_TYPE),
});

export type DevLogRestartMarker = Infer<typeof devLogRestartMarkerSchema>;
