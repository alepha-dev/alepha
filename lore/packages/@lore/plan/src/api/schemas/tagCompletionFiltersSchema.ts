import { type Infer, z } from "alepha";

/**
 * Filter vocabulary of the `tagCompletion` metric.
 *
 * ⚠️ **A tag is a FILTER, not a scope kind.** A card points at a project and
 * this narrows what it counts inside it, which is exactly the distinction
 * `parseFilters` / `defaultFilters` already exist for: the value is validated
 * against this schema on write **and on read**, so a card written before the
 * vocabulary changed degrades rather than resolving against a shape nothing
 * understands.
 *
 * Free text at the schema, and a PICKER in the wizard. The schema cannot
 * enumerate a project's tags - they are rows, not a build-time enum - so the
 * bound is on the control: `DashboardFilterStep` offers the project's own
 * tags, because a typed tag that does not exist is a permanent zero with
 * nothing on screen saying why.
 */
export const tagCompletionFiltersSchema = z.object({
  tag: z.text({ maxLength: 64 }).default(""),
});

export type TagCompletionFilters = Infer<typeof tagCompletionFiltersSchema>;
