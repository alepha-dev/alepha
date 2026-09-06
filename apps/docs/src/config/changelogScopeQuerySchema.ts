import { z } from "alepha";

/**
 * The changelog's only query parameter: `?scope=ui`, `?scope=orm,react`.
 *
 * Declared at module scope because `useQueryParams` keys its re-sync on the
 * schema it is handed, and a schema rebuilt on every render never settles.
 *
 * A free string rather than an enum of the six groups: the param also accepts
 * raw scope tokens, and a value that fails to parse is dropped silently by
 * `useQueryParams`, which would turn a typo into a mysteriously unfiltered
 * page instead of one that shows nothing and says so.
 */
export const changelogScopeQuerySchema = z.object({
  scope: z.string().optional(),
});
