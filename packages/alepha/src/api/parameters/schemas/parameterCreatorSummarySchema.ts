import { type Static, t } from "alepha";

/**
 * Slim view of a parameter version's creator, embedded by the admin history
 * endpoint via a best-effort left join (`parameters.creatorId` → `users.id`)
 * so the UI can render a human-readable identifier (and link) instead of a
 * bare UUID.
 *
 * Optional end-to-end: the join only runs when the `users` entity is
 * registered in the running app (see `ParameterProvider.resolveCreatorJoin`),
 * and a version whose creator was deleted — or who lives in a non-default
 * realm — comes back with `creator` undefined. Callers fall back to the raw
 * `creatorId`.
 */
export const parameterCreatorSummarySchema = t.object({
  id: t.uuid(),
  email: t.optional(t.string({ format: "email" })),
  username: t.optional(t.shortText({ minLength: 3, maxLength: 30 })),
  firstName: t.optional(t.string()),
  lastName: t.optional(t.string()),
});

export type ParameterCreatorSummary = Static<
  typeof parameterCreatorSummarySchema
>;
