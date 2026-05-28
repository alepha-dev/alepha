import { type Static, t } from "alepha";

/**
 * Slim view of a file's uploader, embedded by the admin listing via a
 * best-effort left join (`files.creator` → `users.id`) so the UI can render
 * a human-readable identifier instead of a bare UUID.
 *
 * Optional end-to-end: the join only runs when the `users` entity is
 * registered in the running app (see `FileService.findFiles`), and even then
 * a file whose creator was deleted — or who lives in a non-default realm —
 * comes back with `user` undefined. Callers must fall back to `creatorName`
 * or the raw `creator` id.
 */
export const fileCreatorSummarySchema = t.object({
  id: t.uuid(),
  email: t.optional(t.string({ format: "email" })),
  username: t.optional(t.shortText({ minLength: 3, maxLength: 30 })),
  firstName: t.optional(t.string()),
  lastName: t.optional(t.string()),
});

export type FileCreatorSummary = Static<typeof fileCreatorSummarySchema>;
