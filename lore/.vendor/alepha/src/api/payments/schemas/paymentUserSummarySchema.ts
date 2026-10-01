import { type Infer, z } from "alepha";

/**
 * Slim view of the paying user, embedded by the admin intents listing via a
 * best-effort left join (`payment_intents.userId` → `users.id`) so the UI
 * can render a human-readable identifier instead of a bare UUID.
 *
 * Optional end-to-end: the join only runs when the `users` entity is
 * registered in the running app (see `PaymentService.resolveUserJoin` — the
 * payments module stays usable without `alepha/api/users`), and an intent
 * whose user was deleted — or recorded with no user at all — comes back with
 * `user` undefined. Callers fall back to the raw `userId`.
 */
export const paymentUserSummarySchema = z.object({
  id: z.uuid(),
  email: z.string().meta({ format: "email" }).optional(),
  username: z.shortText({ minLength: 3, maxLength: 30 }).optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

export type PaymentUserSummary = Infer<typeof paymentUserSummarySchema>;
