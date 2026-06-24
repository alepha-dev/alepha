import { type Static, z } from "alepha";

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
export const fileCreatorSummarySchema = z.object({
  id: z.uuid(),
  email: z.string().meta({ format: "email" }).optional(),
  username: z.shortText({ minLength: 3, maxLength: 30 }).optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

export type FileCreatorSummary = Static<typeof fileCreatorSummarySchema>;
