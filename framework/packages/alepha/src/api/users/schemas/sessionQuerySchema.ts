import type { Infer } from "alepha";
import { z } from "alepha";
import { pageQuerySchema } from "alepha/orm";

export const sessionQuerySchema = pageQuerySchema.extend({
  userId: z.uuid().optional(),
  /**
   * Matches the session's IP, or the owner's email or username. One box for
   * the three things an admin has in hand when a session is worth looking
   * up, rather than three that each answer one of them.
   */
  search: z.string().optional(),
  /**
   * ISO 3166-1 alpha-2, as stored. Case-insensitive on the way in.
   */
  country: z.string().optional(),
  /**
   * `active` is `expiresAt` in the future, `expired` is the rest. Omitted
   * means both, which is what the list has always shown.
   */
  status: z.enum(["active", "expired"]).optional(),
  /**
   * Only sessions used within this many hours. `lastUsedAt` is written when
   * the session is created (a sign-in) and rewritten on each token refresh,
   * not on every request. A row whose `lastUsedAt` is null predates the
   * column and is excluded rather than kept.
   */
  lastUsedWithinHours: z.integer().min(1).optional(),
});

export type SessionQuery = Infer<typeof sessionQuerySchema>;
