import { z } from "alepha";

/**
 * The `:id` of a folio-tree route. A folio, a directory and a blob are all
 * addressed by uuid, never by the per-project shortId the URL shows.
 */
export const folioIdParamsSchema = z.object({ id: z.uuid() });
