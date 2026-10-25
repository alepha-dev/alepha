import { type Infer, z } from "alepha";

/**
 * Slim view of the key's owner, embedded by the admin listing via a
 * best-effort left join (`api_keys.userId` → `users.id`) so the UI can
 * render a human-readable identifier instead of a bare UUID.
 *
 * Optional end-to-end: the join only runs when the `users` entity is
 * registered in the running app (see `ApiKeyService.resolveOwnerJoin` — the
 * users module depends on this one, so the entity is looked up at runtime
 * rather than imported), and a key whose owner was deleted comes back with
 * `user` undefined. Callers fall back to the raw `userId`.
 */
export const adminApiKeyOwnerSchema = z.object({
  id: z.uuid(),
  email: z.string().optional(),
  username: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

export type AdminApiKeyOwner = Infer<typeof adminApiKeyOwnerSchema>;
