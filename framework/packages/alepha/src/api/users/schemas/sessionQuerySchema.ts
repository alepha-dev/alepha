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
   * Only sessions used within this many hours. `lastUsedAt` is null until a
   * session is used a second time, and a never-used session is NOT recently
   * active, so it is excluded rather than kept.
   */
  lastUsedWithinHours: z.integer().min(1).optional(),
});

export type SessionQuery = Infer<typeof sessionQuerySchema>;
